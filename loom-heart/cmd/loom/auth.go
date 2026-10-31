package main

// auth.go — the auth verb: pair the CLI with the running app and keep the
// API key it issues, so no environment variable has to carry it.
//
//	loom auth [login] [--code 1234] [--print]   pair (the app shows a 4-digit code)
//	loom auth status                            who the saved key is
//	loom auth logout                            forget the saved key
//
// The key lives in a config file (config.json under the user config dir,
// LOOM_CONFIG overrides), 0600 in a 0700 directory. ANYTYPE_API_KEY
// still wins over it, so a script can override the saved key per process.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	apimodel "github.com/hoangtrung1801/loom/loom-heart/core/api/model"
	v2model "github.com/hoangtrung1801/loom/loom-heart/core/api/v2/model"
	"github.com/hoangtrung1801/loom/loom-heart/core/api/wrapper"
)

// authAppName is how the app's pairing dialog names this client.
const authAppName = "loom"

// cliConfig is the saved configuration. Both fields are optional; the
// environment variables take precedence over them.
type cliConfig struct {
	ApiKey string `json:"api_key,omitempty"`
	ApiUrl string `json:"api_url,omitempty"`
}

func configPath() (string, error) {
	if p := os.Getenv("LOOM_CONFIG"); p != "" {
		return p, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve config dir: %w", err)
	}
	return filepath.Join(dir, "loom", "config.json"), nil
}

// loadConfig reads the config file; a missing or unreadable one is an empty
// config, so a damaged file never bricks the verbs that only want a key.
func loadConfig() cliConfig {
	path, err := configPath()
	if err != nil {
		return cliConfig{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return cliConfig{}
	}
	var cfg cliConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cliConfig{}
	}
	return cfg
}

// saveConfig writes the config atomically (temp file + rename) with 0600
// perms inside a 0700 directory; an empty config removes the file.
func saveConfig(cfg cliConfig) error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if cfg == (cliConfig{}) {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove config file: %w", err)
		}
		return nil
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp config: %w", err)
	}
	defer os.Remove(tmp.Name()) // a no-op once renamed
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("chmod temp config: %w", err)
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp config: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("replace config file: %w", err)
	}
	return nil
}

// resolveAPIKey is the key every verb sends: the environment first, then
// the config file. source says which, for auth status.
func resolveAPIKey() (key, source string) {
	if k := os.Getenv("ANYTYPE_API_KEY"); k != "" {
		return k, "ANYTYPE_API_KEY"
	}
	if k := loadConfig().ApiKey; k != "" {
		return k, "config file"
	}
	return "", ""
}

// resolveAPIURL is ANYTYPE_API_URL, else the config's api_url, else empty
// (the client's default).
func resolveAPIURL() string {
	if u := os.Getenv("ANYTYPE_API_URL"); u != "" {
		return u
	}
	return loadConfig().ApiUrl
}

const authUsage = `usage: loom auth [login] [--code 1234] [--print]   pair with the running app and save an API key
       loom auth status                              show which key is in use
       loom auth logout                              remove the saved key`

func runAuth(argv []string, stdin io.Reader, stdout, stderr io.Writer) int {
	sub := "login"
	if len(argv) > 0 && !strings.HasPrefix(argv[0], "-") {
		sub, argv = argv[0], argv[1:]
	}
	switch sub {
	case "login":
		return authLogin(argv, stdin, stdout, stderr)
	case "status":
		return authStatus(stdout, stderr)
	case "logout":
		return authLogout(stdout, stderr)
	case "help":
		fmt.Fprintln(stdout, authUsage)
		return 0
	}
	fmt.Fprintf(stderr, "error: unknown auth command %q\n%s\n", sub, authUsage)
	return 2
}

func authLogin(argv []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("auth login", flag.ContinueOnError)
	fs.SetOutput(stderr)
	code := fs.String("code", "", "the 4-digit code the app shows (read from stdin when omitted)")
	printKey := fs.Bool("print", false, "also print the key on stdout, for scripts")
	if err := fs.Parse(argv); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if fs.NArg() > 0 {
		fmt.Fprintf(stderr, "error: unexpected argument %q — auth login takes flags only (--code, --print)\n", fs.Arg(0))
		return 2
	}

	ctx := context.Background()
	baseURL := wrapper.NewClient(resolveAPIURL(), "").BaseURL
	var challenge apimodel.CreateChallengeResponse
	if err := authCall(ctx, baseURL, http.MethodPost, "/v2/auth/challenges", "", apimodel.CreateChallengeRequest{AppName: authAppName}, &challenge); err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}

	value := strings.TrimSpace(*code)
	if value == "" {
		fmt.Fprintln(stderr, "A 4-digit code is shown in the Anytype app. Enter it here:")
		line, err := bufio.NewReader(stdin).ReadString('\n')
		if err != nil && line == "" {
			fmt.Fprintln(stderr, "error: no code given — pass --code or type it on stdin")
			return 1
		}
		value = strings.TrimSpace(line)
	}

	var issued apimodel.CreateApiKeyResponse
	if err := authCall(ctx, baseURL, http.MethodPost, "/v2/auth/api_keys", "", apimodel.CreateApiKeyRequest{ChallengeId: challenge.ChallengeId, Code: value}, &issued); err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	if issued.ApiKey == "" {
		fmt.Fprintln(stderr, "error: the server issued no api_key")
		return 1
	}

	cfg := loadConfig()
	cfg.ApiKey = issued.ApiKey
	if err := saveConfig(cfg); err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	path, _ := configPath()
	fmt.Fprintf(stderr, "Paired. API key saved to %s\n", path)
	if *printKey {
		fmt.Fprintln(stdout, issued.ApiKey)
	}
	return 0
}

func authStatus(stdout, stderr io.Writer) int {
	key, source := resolveAPIKey()
	if key == "" {
		fmt.Fprintln(stderr, "error: no API key — run \"loom auth\" or set ANYTYPE_API_KEY")
		return 1
	}
	baseURL := wrapper.NewClient(resolveAPIURL(), "").BaseURL
	var who v2model.WhoamiResponse
	if err := authCall(context.Background(), baseURL, http.MethodGet, "/v2/auth/whoami", key, nil, &who); err != nil {
		fmt.Fprintf(stderr, "error: the key from %s was not accepted: %v\n", source, err)
		return 1
	}
	fmt.Fprintf(stdout, "key:    %s (from %s)\n", who.Key.Name, source)
	fmt.Fprintf(stdout, "scope:  %s, %s\n", who.Scope, who.KeyStatus)
	switch {
	case who.Grant.AllSpaces:
		fmt.Fprintln(stdout, "spaces: all")
	case who.Grant.Restricted:
		fmt.Fprintf(stdout, "spaces: %d granted\n", len(who.Grant.Spaces))
	}
	if who.Grant.Permission != nil {
		fmt.Fprintf(stdout, "access: %s\n", *who.Grant.Permission)
	}
	fmt.Fprintf(stdout, "api:    %s at %s\n", who.Api.Version, baseURL)
	return 0
}

func authLogout(stdout, stderr io.Writer) int {
	cfg := loadConfig()
	if cfg.ApiKey == "" {
		fmt.Fprintln(stdout, "No saved API key.")
		return 0
	}
	cfg.ApiKey = ""
	if err := saveConfig(cfg); err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	fmt.Fprintln(stdout, "Saved API key removed.")
	return 0
}

// authCall runs one auth-route request; a non-2xx answer becomes an error
// carrying the server's own message (the C6 envelope).
func authCall(ctx context.Context, baseURL, method, path, key string, in, out any) error {
	var body io.Reader
	if in != nil {
		payload, err := json.Marshal(in)
		if err != nil {
			return fmt.Errorf("encode %s %s: %w", method, path, err)
		}
		body = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, baseURL+path, body)
	if err != nil {
		return fmt.Errorf("build %s %s: %w", method, path, err)
	}
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s (is Anytype running with the API on?): %w", method, baseURL+path, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read %s %s: %w", method, path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var envelope v2model.Error
		if json.Unmarshal(data, &envelope) == nil && envelope.Message != "" {
			return errors.New(envelope.Message)
		}
		return fmt.Errorf("server answered %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("decode %s %s: %w", method, path, err)
	}
	return nil
}
