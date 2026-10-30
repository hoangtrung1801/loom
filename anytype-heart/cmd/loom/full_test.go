package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fullStub serves the real v2 OpenAPI document (the full table's source)
// and hands every other request to handler. /v2/schemas answers 404, so the
// table derives with bare op lists — the documented fallback.
func fullStub(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	doc, err := os.ReadFile(filepath.Join("..", "..", "core", "api", "docs", "v2", "openapi.json"))
	require.NoError(t, err)
	stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v2/docs/openapi.json":
			_, _ = w.Write(doc)
		case strings.HasPrefix(r.URL.Path, "/v2/schemas"):
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, `{"status":404,"code":"not_found","message":"no schemas here","issues":[]}`)
		default:
			handler(w, r)
		}
	})
}

// recordingStub is fullStub that also records the path of every request.
func recordingStub(t *testing.T, handler http.HandlerFunc) func() []string {
	t.Helper()
	var mu sync.Mutex
	var paths []string
	fullStub(t, func(w http.ResponseWriter, r *http.Request) {
		handler(w, r)
	})
	// wrap the server fullStub started: record by re-pointing at a proxy
	target := os.Getenv("ANYTYPE_API_URL")
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.Method+" "+r.URL.Path)
		mu.Unlock()
		req, err := http.NewRequestWithContext(r.Context(), r.Method, target+r.URL.RequestURI(), r.Body)
		require.NoError(t, err)
		req.Header = r.Header.Clone()
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	}))
	t.Cleanup(proxy.Close)
	t.Setenv("ANYTYPE_API_URL", proxy.URL)
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), paths...)
	}
}

func TestRunAPIRequestCount(t *testing.T) {
	handler := func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"data":[],"has_more":false}`) }

	t.Run("running one operation reads only the OpenAPI document and the call", func(t *testing.T) {
		// given
		requests := recordingStub(t, handler)

		// when
		code, _, stderr := runCLI("api", "list_types", "space_id=bafyspace1")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, []string{"GET /v2/docs/openapi.json", "GET /v2/spaces/bafyspace1/types"}, requests())
	})

	t.Run("describing one operation makes exactly one request", func(t *testing.T) {
		// given
		requests := recordingStub(t, handler)

		// when
		code, _, stderr := runCLI("api", "list_types", "--help")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, []string{"GET /v2/docs/openapi.json"}, requests())
	})

	t.Run("the listing also reads the op schemas", func(t *testing.T) {
		// given
		requests := recordingStub(t, handler)

		// when
		code, _, stderr := runCLI("api")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, []string{"GET /v2/docs/openapi.json", "GET /v2/schemas"}, requests())
	})
}

func TestRunAPI(t *testing.T) {
	t.Run("lists every operation with its hints", func(t *testing.T) {
		// given
		fullStub(t, func(w http.ResponseWriter, r *http.Request) { t.Errorf("unexpected request %s", r.URL.Path) })

		// when
		code, stdout, stderr := runCLI("api")

		// then
		require.Equal(t, 0, code, stderr)
		for _, op := range []string{"create_object", "patch_object", "delete_object", "create_type", "update_property", "list_property_options", "create_query", "create_widget", "add_chat_message"} {
			assert.Contains(t, stdout, op)
		}
		assert.Regexp(t, `delete_object\s+.*\[destructive\]`, stdout)
		assert.Regexp(t, `list_types\s+.*\[read-only\]`, stdout)
	})

	t.Run("key=value arguments become path and query parameters", func(t *testing.T) {
		// given
		var got *http.Request
		fullStub(t, func(w http.ResponseWriter, r *http.Request) {
			got = r
			fmt.Fprint(w, `{"data":[{"key":"task","name":"Task"}],"has_more":false}`)
		})

		// when
		code, stdout, stderr := runCLI("api", "list_types", "space_id=bafyspace1", "limit=5")

		// then
		require.Equal(t, 0, code, stderr)
		require.NotNil(t, got)
		assert.Equal(t, "/v2/spaces/bafyspace1/types", got.URL.Path)
		assert.Equal(t, "5", got.URL.Query().Get("limit"))
		assert.Equal(t, "Bearer test-key", got.Header.Get("Authorization"))
		assert.Contains(t, stdout, `"name":"Task"`)
	})

	t.Run("a JSON object from stdin becomes the request body", func(t *testing.T) {
		// given
		var method, path string
		var body map[string]any
		fullStub(t, func(w http.ResponseWriter, r *http.Request) {
			method, path = r.Method, r.URL.Path
			raw, _ := io.ReadAll(r.Body)
			require.NoError(t, json.Unmarshal(raw, &body))
			fmt.Fprint(w, `{"id":"bafyobject1"}`)
		})

		// when
		code, stdout, stderr := runCLIWithStdin(`{"space_id":"bafyspace1","type":"page","name":"Plan"}`, "api", "create_object", "-")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, "POST", method)
		assert.Equal(t, "/v2/spaces/bafyspace1/objects", path)
		assert.Equal(t, "Plan", body["name"])
		assert.NotContains(t, body, "space_id", "a path parameter never rides in the body")
		assert.Contains(t, stdout, "bafyobject1")
	})

	t.Run("--help shows the operation's argument schema", func(t *testing.T) {
		// given
		fullStub(t, func(w http.ResponseWriter, r *http.Request) { t.Errorf("unexpected request %s", r.URL.Path) })

		// when
		code, stdout, stderr := runCLI("api", "delete_object", "--help")

		// then
		require.Equal(t, 0, code, stderr)
		assert.Contains(t, stdout, "delete_object [destructive]")
		assert.Contains(t, stdout, `"object_id"`)
	})

	t.Run("an unknown operation exits 2", func(t *testing.T) {
		// given
		fullStub(t, func(w http.ResponseWriter, r *http.Request) {})

		// when
		code, _, stderr := runCLI("api", "drop_everything")

		// then
		assert.Equal(t, 2, code)
		assert.Contains(t, stderr, `unknown operation "drop_everything"`)
	})

	t.Run("a refusal exits 1 with the server's message", func(t *testing.T) {
		// given
		fullStub(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, `{"status":404,"code":"not_found","message":"object bafygone not found","issues":[]}`)
		})

		// when
		code, _, stderr := runCLI("api", "get_object", "space_id=bafyspace1", "object_id=bafygone")

		// then
		assert.Equal(t, 1, code)
		assert.Contains(t, stderr, "object bafygone not found")
	})

	t.Run("bad arguments exit 2", func(t *testing.T) {
		// given
		fullStub(t, func(w http.ResponseWriter, r *http.Request) {})

		// when
		code, _, stderr := runCLI("api", "list_types", "space_id")

		// then
		assert.Equal(t, 2, code)
		assert.Contains(t, stderr, "key=value")
	})

	t.Run("no server says what is needed", func(t *testing.T) {
		// given
		t.Setenv("ANYTYPE_API_URL", "http://127.0.0.1:1")
		t.Setenv("LOOM_CONFIG", t.TempDir()+"/config.json")
		t.Setenv("ANYTYPE_API_KEY", "test-key")

		// when
		code, _, stderr := runCLI("api")

		// then
		assert.Equal(t, 1, code)
		assert.Contains(t, stderr, "is Anytype running")
	})
}

func TestRunFullTier(t *testing.T) {
	t.Run("mcp --tier full serves every operation over stdio and runs them", func(t *testing.T) {
		// given
		fullStub(t, func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "DELETE", r.Method)
			require.Equal(t, "/v2/spaces/bafyspace1/objects/bafyobject1", r.URL.Path)
			fmt.Fprint(w, `{"id":"bafyobject1","archived":true}`)
		})
		script := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}` + "\n" +
			`{"jsonrpc":"2.0","id":2,"method":"tools/list"}` + "\n" +
			`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"delete_object","arguments":{"space_id":"bafyspace1","object_id":"bafyobject1"}}}` + "\n"

		// when
		code, stdout, stderr := runCLIWithStdin(script, "mcp", "--tier", "full")

		// then
		require.Equal(t, 0, code, stderr)
		lines := strings.Split(strings.TrimSpace(stdout), "\n")
		require.Len(t, lines, 3)
		var list struct {
			Result struct {
				Tools []struct {
					Name        string `json:"name"`
					Annotations *struct {
						DestructiveHint bool `json:"destructiveHint"`
					} `json:"annotations"`
				} `json:"tools"`
			} `json:"result"`
		}
		require.NoError(t, json.Unmarshal([]byte(lines[1]), &list))
		names := map[string]bool{}
		for _, tool := range list.Result.Tools {
			names[tool.Name] = true
			if tool.Name == "delete_object" {
				require.NotNil(t, tool.Annotations)
				assert.True(t, tool.Annotations.DestructiveHint)
			}
		}
		for _, op := range []string{"create_object", "patch_object", "delete_object", "restore_object", "create_type", "delete_property", "create_collection", "list_widgets"} {
			assert.True(t, names[op], op)
		}
		assert.Contains(t, lines[2], `\"archived\":true`)
	})

	t.Run("tools --tier full prints the derived tools/list", func(t *testing.T) {
		// given
		fullStub(t, func(w http.ResponseWriter, r *http.Request) {})

		// when
		code, stdout, stderr := runCLI("tools", "--tier", "full")

		// then
		require.Equal(t, 0, code, stderr)
		var got struct {
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
		}
		require.NoError(t, json.Unmarshal([]byte(stdout), &got))
		assert.Greater(t, len(got.Tools), 40)
	})

	t.Run("mcp --tier full without a server exits 1 before serving", func(t *testing.T) {
		// given
		t.Setenv("ANYTYPE_API_URL", "http://127.0.0.1:1")
		t.Setenv("LOOM_CONFIG", t.TempDir()+"/config.json")

		// when
		code, stdout, stderr := runCLIWithStdin("", "mcp", "--tier", "full")

		// then
		assert.Equal(t, 1, code)
		assert.Empty(t, stdout)
		assert.Contains(t, stderr, "full tool table")
	})
}
