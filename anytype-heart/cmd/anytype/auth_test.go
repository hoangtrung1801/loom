package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// pairingStub serves the auth routes: the right code is "1234", and the key
// it issues is "issued-key". whoami accepts only that key. It points the
// CLI at itself with no env key and a fresh config path, and returns the
// config path.
func pairingStub(t *testing.T, other http.HandlerFunc) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /v2/auth/challenges":
			raw, _ := io.ReadAll(r.Body)
			assert.JSONEq(t, `{"app_name":"anytype-cli"}`, string(raw))
			fmt.Fprint(w, `{"challenge_id":"chal1"}`)
		case "POST /v2/auth/api_keys":
			var req struct {
				ChallengeId string `json:"challenge_id"`
				Code        string `json:"code"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
			if req.ChallengeId != "chal1" || req.Code != "1234" {
				w.WriteHeader(http.StatusForbidden)
				fmt.Fprint(w, `{"status":403,"code":"forbidden","message":"the code does not match","issues":[]}`)
				return
			}
			fmt.Fprint(w, `{"api_key":"issued-key","grant":null}`)
		case "GET /v2/auth/whoami":
			if r.Header.Get("Authorization") != "Bearer issued-key" {
				w.WriteHeader(http.StatusUnauthorized)
				fmt.Fprint(w, `{"status":401,"code":"unauthorized","message":"invalid key","issues":[]}`)
				return
			}
			fmt.Fprint(w, `{"key":{"id":"k","name":"anytype-cli"},"scope":"jsonApi","grant":{"scoped":false,"restricted":false,"all_spaces":false,"permission":null,"spaces":[]},"api":{"version":"2025-11-08"},"key_status":"legacy"}`)
		default:
			other(w, r)
		}
	}))
	t.Cleanup(server.Close)
	t.Setenv("ANYTYPE_API_URL", server.URL)
	t.Setenv("ANYTYPE_API_KEY", "")
	t.Setenv("ANYTYPE_CLI_SESSION", t.TempDir()+"/session.json")
	path := filepath.Join(t.TempDir(), "cfg", "config.json")
	t.Setenv("ANYTYPE_CLI_CONFIG", path)
	return path
}

func noOtherRoutes(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
	}
}

func readSavedKey(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var cfg cliConfig
	require.NoError(t, json.Unmarshal(data, &cfg))
	return cfg.ApiKey
}

func TestAuthLogin(t *testing.T) {
	t.Run("--code pairs and saves the key privately without printing it", func(t *testing.T) {
		// given
		path := pairingStub(t, noOtherRoutes(t))

		// when
		code, stdout, stderr := runCLI("auth", "--code", "1234")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Empty(t, stdout)
		assert.NotContains(t, stderr, "issued-key")
		assert.Equal(t, "issued-key", readSavedKey(t, path))
		info, err := os.Stat(path)
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
		dir, err := os.Stat(filepath.Dir(path))
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o700), dir.Mode().Perm())
	})

	t.Run("the code is read from stdin when --code is absent", func(t *testing.T) {
		// given
		path := pairingStub(t, noOtherRoutes(t))

		// when
		code, _, stderr := runCLIWithStdin("1234\n", "auth", "login")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Contains(t, stderr, "4-digit code")
		assert.Equal(t, "issued-key", readSavedKey(t, path))
	})

	t.Run("--print writes the key to stdout", func(t *testing.T) {
		// given
		pairingStub(t, noOtherRoutes(t))

		// when
		code, stdout, stderr := runCLI("auth", "--code", "1234", "--print")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, "issued-key\n", stdout)
	})

	t.Run("a wrong code exits 1 with the server's message and saves nothing", func(t *testing.T) {
		// given
		path := pairingStub(t, noOtherRoutes(t))

		// when
		code, _, stderr := runCLI("auth", "--code", "0000")

		// then
		assert.Equal(t, 1, code)
		assert.Contains(t, stderr, "the code does not match")
		assert.NoFileExists(t, path)
	})

	t.Run("no code on stdin exits 1", func(t *testing.T) {
		// given
		path := pairingStub(t, noOtherRoutes(t))

		// when
		code, _, stderr := runCLIWithStdin("", "auth")

		// then
		assert.Equal(t, 1, code)
		assert.Contains(t, stderr, "no code given")
		assert.NoFileExists(t, path)
	})

	t.Run("the saved key is the bearer of other verbs, and the environment wins", func(t *testing.T) {
		// given
		var bearers []string
		pairingStub(t, func(w http.ResponseWriter, r *http.Request) {
			bearers = append(bearers, r.Header.Get("Authorization"))
			fmt.Fprint(w, `{"data":[],"total":0,"offset":0,"limit":25,"has_more":false}`)
		})
		code, _, stderr := runCLI("auth", "--code", "1234")
		require.Equal(t, 0, code, stderr)

		// when
		code, _, stderr = runCLI("spaces")
		require.Equal(t, 0, code, stderr)
		t.Setenv("ANYTYPE_API_KEY", "env-key")
		code, _, stderr = runCLI("spaces")
		require.Equal(t, 0, code, stderr)

		// then
		assert.Equal(t, []string{"Bearer issued-key", "Bearer env-key"}, bearers)
	})

	t.Run("the config may hold the api url", func(t *testing.T) {
		// given
		path := pairingStub(t, noOtherRoutes(t))
		serverURL := os.Getenv("ANYTYPE_API_URL")
		t.Setenv("ANYTYPE_API_URL", "")
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
		require.NoError(t, os.WriteFile(path, []byte(`{"api_url":"`+serverURL+`"}`), 0o600))

		// when
		code, _, stderr := runCLI("auth", "--code", "1234")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, "issued-key", readSavedKey(t, path))
		assert.Equal(t, serverURL, resolveAPIURL(), "pairing keeps the url")
	})
}

func TestAuthStatusAndLogout(t *testing.T) {
	t.Run("status names the key in use", func(t *testing.T) {
		// given
		pairingStub(t, noOtherRoutes(t))
		code, _, stderr := runCLI("auth", "--code", "1234")
		require.Equal(t, 0, code, stderr)

		// when
		code, stdout, stderr := runCLI("auth", "status")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Contains(t, stdout, "anytype-cli (from config file)")
		assert.Contains(t, stdout, "jsonApi")
		assert.NotContains(t, stdout, "issued-key")
	})

	t.Run("status without a key exits 1", func(t *testing.T) {
		// given
		pairingStub(t, noOtherRoutes(t))

		// when
		code, _, stderr := runCLI("auth", "status")

		// then
		assert.Equal(t, 1, code)
		assert.Contains(t, stderr, "no API key")
	})

	t.Run("status with a rejected key exits 1 with the server's message", func(t *testing.T) {
		// given
		pairingStub(t, noOtherRoutes(t))
		t.Setenv("ANYTYPE_API_KEY", "stale")

		// when
		code, _, stderr := runCLI("auth", "status")

		// then
		assert.Equal(t, 1, code)
		assert.Contains(t, stderr, "invalid key")
	})

	t.Run("logout removes the saved key", func(t *testing.T) {
		// given
		path := pairingStub(t, noOtherRoutes(t))
		code, _, stderr := runCLI("auth", "--code", "1234")
		require.Equal(t, 0, code, stderr)

		// when
		code, _, stderr = runCLI("auth", "logout")

		// then
		require.Equal(t, 0, code, stderr)
		assert.NoFileExists(t, path)
		code, _, _ = runCLI("auth", "status")
		assert.Equal(t, 1, code)
	})

	t.Run("an unknown subcommand exits 2", func(t *testing.T) {
		// given
		pairingStub(t, noOtherRoutes(t))

		// when
		code, _, stderr := runCLI("auth", "refresh")

		// then
		assert.Equal(t, 2, code)
		assert.Contains(t, stderr, `unknown auth command "refresh"`)
	})
}
