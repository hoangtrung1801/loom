package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/hoangtrung1801/loom/loom-heart/pb"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
)

func noEnv(string) string { return "" }

func TestParseServeFlags(t *testing.T) {
	t.Run("defaults", func(t *testing.T) {
		dir := t.TempDir()

		got, err := parseServeFlags([]string{"--data-dir", dir}, &bytes.Buffer{})

		require.NoError(t, err)
		assert.Equal(t, dir, got.dataDir)
		assert.Equal(t, serveDefaultAPIAddr, got.apiAddr)
		assert.Equal(t, pb.RpcAccount_DefaultConfig, got.networkMode())
	})

	t.Run("custom network config selects custom mode", func(t *testing.T) {
		cfg := filepath.Join(t.TempDir(), "network.yml")
		require.NoError(t, os.WriteFile(cfg, []byte("id: x\n"), 0o600))

		got, err := parseServeFlags([]string{"--data-dir", t.TempDir(), "--network-config", cfg}, &bytes.Buffer{})

		require.NoError(t, err)
		assert.Equal(t, pb.RpcAccount_CustomConfig, got.networkMode())
		assert.Equal(t, cfg, got.networkConfig)
	})

	t.Run("local only", func(t *testing.T) {
		got, err := parseServeFlags([]string{"--data-dir", t.TempDir(), "--local-only"}, &bytes.Buffer{})

		require.NoError(t, err)
		assert.Equal(t, pb.RpcAccount_LocalOnly, got.networkMode())
	})

	for name, argv := range map[string][]string{
		"missing network config file": {"--network-config", "/nonexistent/network.yml"},
		"local only with config":      {"--local-only", "--network-config", "x.yml"},
		"new with mnemonic file":      {"--new", "--mnemonic-file", "m.txt"},
		"stray argument":              {"extra"},
	} {
		t.Run("rejects "+name, func(t *testing.T) {
			_, err := parseServeFlags(append([]string{"--data-dir", t.TempDir()}, argv...), &bytes.Buffer{})

			assert.Error(t, err)
		})
	}
}

func TestResolveMnemonic(t *testing.T) {
	t.Run("environment wins over file and remembered phrase", func(t *testing.T) {
		dir := t.TempDir()
		require.NoError(t, rememberMnemonic(dir, "remembered one"))
		file := filepath.Join(t.TempDir(), "m.txt")
		require.NoError(t, os.WriteFile(file, []byte("from file\n"), 0o600))
		env := func(k string) string {
			if k == "LOOM_MNEMONIC" {
				return "  from   env \n"
			}
			return ""
		}

		got, source, err := resolveMnemonic(serveOptions{dataDir: dir, mnemonicFile: file}, env)

		require.NoError(t, err)
		assert.Equal(t, "from env", got)
		assert.Equal(t, "LOOM_MNEMONIC", source)
	})

	t.Run("file wins over remembered phrase", func(t *testing.T) {
		dir := t.TempDir()
		require.NoError(t, rememberMnemonic(dir, "remembered one"))
		file := filepath.Join(t.TempDir(), "m.txt")
		require.NoError(t, os.WriteFile(file, []byte("from\nfile\n"), 0o600))

		got, _, err := resolveMnemonic(serveOptions{dataDir: dir, mnemonicFile: file}, noEnv)

		require.NoError(t, err)
		assert.Equal(t, "from file", got)
	})

	t.Run("remembered phrase", func(t *testing.T) {
		dir := t.TempDir()
		require.NoError(t, rememberMnemonic(dir, "remembered one"))

		got, source, err := resolveMnemonic(serveOptions{dataDir: dir}, noEnv)

		require.NoError(t, err)
		assert.Equal(t, "remembered one", got)
		assert.Equal(t, filepath.Join(dir, serveMnemonicFile), source)
	})

	t.Run("nothing supplied", func(t *testing.T) {
		got, _, err := resolveMnemonic(serveOptions{dataDir: t.TempDir()}, noEnv)

		require.NoError(t, err)
		assert.Empty(t, got)
	})

	t.Run("missing or empty file is an error", func(t *testing.T) {
		_, _, err := resolveMnemonic(serveOptions{dataDir: t.TempDir(), mnemonicFile: "/nonexistent/m.txt"}, noEnv)
		assert.Error(t, err)

		empty := filepath.Join(t.TempDir(), "m.txt")
		require.NoError(t, os.WriteFile(empty, []byte("\n"), 0o600))
		_, _, err = resolveMnemonic(serveOptions{dataDir: t.TempDir(), mnemonicFile: empty}, noEnv)
		assert.Error(t, err)
	})
}

func TestRememberMnemonic(t *testing.T) {
	t.Run("stores the phrase privately", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "data")

		require.NoError(t, rememberMnemonic(dir, "a b c"))

		info, err := os.Stat(filepath.Join(dir, serveMnemonicFile))
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	})

	t.Run("same phrase again is fine, a different one is refused", func(t *testing.T) {
		dir := t.TempDir()
		require.NoError(t, rememberMnemonic(dir, "a b c"))

		assert.NoError(t, rememberMnemonic(dir, "a b c"))
		assert.Error(t, rememberMnemonic(dir, "d e f"))
		data, err := os.ReadFile(filepath.Join(dir, serveMnemonicFile))
		require.NoError(t, err)
		assert.Equal(t, "a b c\n", string(data))
	})
}

func TestServeAPIURL(t *testing.T) {
	for addr, want := range map[string]string{
		"127.0.0.1:31009": "http://127.0.0.1:31009",
		"0.0.0.0:31009":   "http://127.0.0.1:31009",
		":31009":          "http://127.0.0.1:31009",
		"[::]:31009":      "http://127.0.0.1:31009",
		"10.0.0.5:8080":   "http://10.0.0.5:8080",
	} {
		assert.Equal(t, want, serveAPIURL(addr), addr)
	}
}

// fakeServeMW records the calls startServe makes and answers with canned
// responses; a non-empty failAt makes that step fail.
type fakeServeMW struct {
	calls  []string
	failAt string

	createReq *pb.RpcAccountCreateRequest
	selectReq *pb.RpcAccountSelectRequest
	recovered string
}

func (f *fakeServeMW) InitialSetParameters(_ context.Context, _ *pb.RpcInitialSetParametersRequest) *pb.RpcInitialSetParametersResponse {
	f.calls = append(f.calls, "init")
	resp := &pb.RpcInitialSetParametersResponse{Error: &pb.RpcInitialSetParametersResponseError{}}
	if f.failAt == "init" {
		resp.Error = &pb.RpcInitialSetParametersResponseError{Code: pb.RpcInitialSetParametersResponseError_BAD_INPUT, Description: "bad version"}
	}
	return resp
}

func (f *fakeServeMW) WalletCreate(_ context.Context, _ *pb.RpcWalletCreateRequest) *pb.RpcWalletCreateResponse {
	f.calls = append(f.calls, "walletCreate")
	return &pb.RpcWalletCreateResponse{Mnemonic: "new words here", Error: &pb.RpcWalletCreateResponseError{}}
}

func (f *fakeServeMW) WalletRecover(_ context.Context, req *pb.RpcWalletRecoverRequest) *pb.RpcWalletRecoverResponse {
	f.calls = append(f.calls, "walletRecover")
	f.recovered = req.Mnemonic
	resp := &pb.RpcWalletRecoverResponse{Error: &pb.RpcWalletRecoverResponseError{}}
	if f.failAt == "walletRecover" {
		resp.Error = &pb.RpcWalletRecoverResponseError{Code: pb.RpcWalletRecoverResponseError_BAD_INPUT, Description: "bad phrase"}
	}
	return resp
}

func (f *fakeServeMW) WalletCreateSession(_ context.Context, _ *pb.RpcWalletCreateSessionRequest) *pb.RpcWalletCreateSessionResponse {
	f.calls = append(f.calls, "session")
	return &pb.RpcWalletCreateSessionResponse{AccountId: "acc-existing", Error: &pb.RpcWalletCreateSessionResponseError{}}
}

func (f *fakeServeMW) AccountCreate(_ context.Context, req *pb.RpcAccountCreateRequest) *pb.RpcAccountCreateResponse {
	f.calls = append(f.calls, "accountCreate")
	f.createReq = req
	return &pb.RpcAccountCreateResponse{
		Account: &model.Account{Id: "acc-new"},
		Error:   &pb.RpcAccountCreateResponseError{},
	}
}

func (f *fakeServeMW) AccountSelect(_ context.Context, req *pb.RpcAccountSelectRequest) *pb.RpcAccountSelectResponse {
	f.calls = append(f.calls, "accountSelect")
	f.selectReq = req
	resp := &pb.RpcAccountSelectResponse{Error: &pb.RpcAccountSelectResponseError{}}
	if f.failAt == "accountSelect" {
		resp.Error = &pb.RpcAccountSelectResponseError{Code: pb.RpcAccountSelectResponseError_FAILED_TO_RUN_NODE, Description: "boom"}
	}
	return resp
}

func (f *fakeServeMW) AccountLocalLinkCreateApp(_ context.Context, _ *pb.RpcAccountLocalLinkCreateAppRequest) *pb.RpcAccountLocalLinkCreateAppResponse {
	f.calls = append(f.calls, "createApp")
	return &pb.RpcAccountLocalLinkCreateAppResponse{AppKey: "key", Error: &pb.RpcAccountLocalLinkCreateAppResponseError{}}
}

func (f *fakeServeMW) AppShutdown(_ context.Context, _ *pb.RpcAppShutdownRequest) *pb.RpcAppShutdownResponse {
	f.calls = append(f.calls, "shutdown")
	return &pb.RpcAppShutdownResponse{}
}

func TestStartServe(t *testing.T) {
	t.Run("new account stores its phrase before creating the account", func(t *testing.T) {
		fx := &fakeServeMW{}
		opt := serveOptions{dataDir: t.TempDir(), name: "Loom", apiAddr: "127.0.0.1:1", networkConfig: "/n.yml", noLanSync: true}
		opt.networkConfig = ""

		id, created, err := startServe(context.Background(), fx, opt, "", &bytes.Buffer{})

		require.NoError(t, err)
		assert.Equal(t, "acc-new", id)
		assert.Equal(t, "new words here", created)
		assert.Equal(t, []string{"init", "walletCreate", "accountCreate"}, fx.calls)
		assert.Equal(t, "127.0.0.1:1", fx.createReq.JsonApiListenAddr)
		assert.True(t, fx.createReq.DisableLocalNetworkSync)
		assert.Equal(t, pb.RpcAccount_DefaultConfig, fx.createReq.NetworkMode)
		stored, err := os.ReadFile(filepath.Join(opt.dataDir, serveMnemonicFile))
		require.NoError(t, err)
		assert.Equal(t, "new words here\n", string(stored))
	})

	t.Run("existing account recovers the wallet then selects the derived id", func(t *testing.T) {
		fx := &fakeServeMW{}
		opt := serveOptions{dataDir: t.TempDir(), apiAddr: "127.0.0.1:1", networkConfig: "/n.yml"}
		stderr := &bytes.Buffer{}

		id, created, err := startServe(context.Background(), fx, opt, "my words", stderr)

		require.NoError(t, err)
		assert.Equal(t, "acc-existing", id)
		assert.Empty(t, created)
		assert.Equal(t, []string{"init", "walletRecover", "session", "accountSelect"}, fx.calls)
		assert.Equal(t, "my words", fx.recovered)
		assert.Equal(t, "acc-existing", fx.selectReq.Id)
		assert.Equal(t, opt.dataDir, fx.selectReq.RootPath)
		assert.Equal(t, pb.RpcAccount_CustomConfig, fx.selectReq.NetworkMode)
		assert.Equal(t, "/n.yml", fx.selectReq.NetworkCustomConfigFilePath)
		assert.Contains(t, stderr.String(), "first start")
	})

	t.Run("a step's own error field fails the start and stops the sequence", func(t *testing.T) {
		for failAt, wantCalls := range map[string][]string{
			"init":          {"init"},
			"walletRecover": {"init", "walletRecover"},
			"accountSelect": {"init", "walletRecover", "session", "accountSelect"},
		} {
			fx := &fakeServeMW{failAt: failAt}

			_, _, err := startServe(context.Background(), fx, serveOptions{dataDir: t.TempDir()}, "my words", &bytes.Buffer{})

			require.Error(t, err, failAt)
			assert.Equal(t, wantCalls, fx.calls, failAt)
		}
	})
}
