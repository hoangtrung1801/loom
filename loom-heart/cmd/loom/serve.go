package main

// serve.go — the serve verb: run Loom's middleware in this process, with no
// desktop app, so a machine (a server, a NAS, a VM) holds a full copy of an
// account's data and keeps it in sync through the any-sync network. The
// desktop app on another machine signs in with the same recovery phrase and
// the two stay in sync; nothing here talks to the app directly.
//
//	loom serve --new                          create an account, print its recovery phrase once
//	LOOM_MNEMONIC="…" loom serve              join an existing account
//	loom serve --mnemonic-file phrase.txt     same, phrase read from a file
//	loom serve                                restart (phrase remembered in the data dir)
//
// It also brings up the JSON API and saves a key for it in the CLI config
// file, so `loom find …`, `loom api …` and `loom mcp` work against this
// server straight away.

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/hoangtrung1801/loom/loom-heart/core"
	"github.com/hoangtrung1801/loom/loom-heart/core/api"
	v2model "github.com/hoangtrung1801/loom/loom-heart/core/api/v2/model"
	"github.com/hoangtrung1801/loom/loom-heart/core/event"
	"github.com/hoangtrung1801/loom/loom-heart/pb"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
)

const (
	serveUsage = `usage: loom serve [--new | --mnemonic-file FILE] [--data-dir DIR] [--network-config FILE]
                  [--api-addr ADDR] [--name NAME] [--remember] [--no-lan-sync] [--local-only]

  Runs Loom's middleware in this process, syncing the account through the any-sync
  network, and serves the JSON API for the other loom verbs. Stop with Ctrl-C.

  The account comes from, in order: LOOM_MNEMONIC, --mnemonic-file, the phrase
  remembered in the data dir, or --new (creates one and prints the phrase once).
  Sign in to the same account in the desktop app with that phrase to sync with it.

  --backup-dir exports every space to Markdown into DIR (one folder per space) after the
  first minute and then every --backup-every. --backup-git also commits the changes to a
  git repository in DIR (created if needed); --backup-push pushes them, to --backup-remote
  if origin is not set yet. Use a PRIVATE repository: the export is plain text.`

	serveClientPlatform = "loom-serve"
	serveClientVersion  = "0.0.0-loom-serve"
	serveAppName        = "loom-serve"
	serveDefaultAPIAddr = "127.0.0.1:31009"
	serveMnemonicFile   = "mnemonic"
	serveAPITimeout     = 2 * time.Minute
)

// serveMiddleware is the part of the middleware serve drives. *core.Middleware
// satisfies it; the interface exists so the start-up sequence is testable.
type serveMiddleware interface {
	InitialSetParameters(ctx context.Context, req *pb.RpcInitialSetParametersRequest) *pb.RpcInitialSetParametersResponse
	WalletCreate(ctx context.Context, req *pb.RpcWalletCreateRequest) *pb.RpcWalletCreateResponse
	WalletRecover(ctx context.Context, req *pb.RpcWalletRecoverRequest) *pb.RpcWalletRecoverResponse
	WalletCreateSession(ctx context.Context, req *pb.RpcWalletCreateSessionRequest) *pb.RpcWalletCreateSessionResponse
	AccountCreate(ctx context.Context, req *pb.RpcAccountCreateRequest) *pb.RpcAccountCreateResponse
	AccountSelect(ctx context.Context, req *pb.RpcAccountSelectRequest) *pb.RpcAccountSelectResponse
	AccountLocalLinkCreateApp(ctx context.Context, req *pb.RpcAccountLocalLinkCreateAppRequest) *pb.RpcAccountLocalLinkCreateAppResponse
	AppShutdown(ctx context.Context, req *pb.RpcAppShutdownRequest) *pb.RpcAppShutdownResponse
}

var _ serveMiddleware = (*core.Middleware)(nil)

type serveOptions struct {
	dataDir       string
	mnemonicFile  string
	networkConfig string
	apiAddr       string
	name          string
	newAccount    bool
	remember      bool
	noLanSync     bool
	localOnly     bool
	backup        backupOptions
}

func (o serveOptions) networkMode() pb.RpcAccountNetworkMode {
	switch {
	case o.localOnly:
		return pb.RpcAccount_LocalOnly
	case o.networkConfig != "":
		return pb.RpcAccount_CustomConfig
	default:
		return pb.RpcAccount_DefaultConfig
	}
}

func (o serveOptions) networkLabel() string {
	switch o.networkMode() {
	case pb.RpcAccount_LocalOnly:
		return "none (local only, nothing syncs)"
	case pb.RpcAccount_CustomConfig:
		return "custom any-sync network (" + o.networkConfig + ")"
	default:
		return "default any-sync network"
	}
}

func defaultServeDataDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve config dir: %w", err)
	}
	return filepath.Join(dir, "loom", "serve"), nil
}

func parseServeFlags(argv []string, stderr io.Writer) (serveOptions, error) {
	var opt serveOptions
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() { fmt.Fprintln(stderr, serveUsage) }
	fs.StringVar(&opt.dataDir, "data-dir", "", "where the account's data lives (default: loom/serve under the user config dir)")
	fs.StringVar(&opt.mnemonicFile, "mnemonic-file", "", "file holding the account's recovery phrase")
	fs.StringVar(&opt.networkConfig, "network-config", "", "network config YAML of a self-hosted any-sync network (default: the built-in network)")
	fs.StringVar(&opt.apiAddr, "api-addr", serveDefaultAPIAddr, "address the JSON API listens on")
	fs.StringVar(&opt.name, "name", "Loom", "profile name for a new account")
	fs.BoolVar(&opt.newAccount, "new", false, "create a new account and print its recovery phrase")
	fs.BoolVar(&opt.remember, "remember", false, "store a recovery phrase given by env or file in the data dir, so restarts need no input")
	fs.BoolVar(&opt.noLanSync, "no-lan-sync", false, "do not sync directly with devices on the local network")
	fs.BoolVar(&opt.localOnly, "local-only", false, "do not sync at all (offline testing)")
	fs.StringVar(&opt.backup.dir, "backup-dir", "", "export every space to Markdown into this directory on a schedule")
	fs.DurationVar(&opt.backup.every, "backup-every", time.Hour, "how often to back up (at least 1m)")
	fs.BoolVar(&opt.backup.git, "backup-git", false, "commit the backup's changes to git (the repository is created if needed)")
	fs.BoolVar(&opt.backup.push, "backup-push", false, "push the backup commits (implies --backup-git)")
	fs.StringVar(&opt.backup.remote, "backup-remote", "", "URL to add as origin when the backup repository has none")
	if err := fs.Parse(argv); err != nil {
		return opt, err
	}
	if fs.NArg() > 0 {
		return opt, fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	if opt.backup.dir == "" {
		if opt.backup.git || opt.backup.push || opt.backup.remote != "" {
			return opt, errors.New("--backup-git, --backup-push and --backup-remote need --backup-dir")
		}
	} else {
		if opt.backup.every < backupMinInterval {
			return opt, fmt.Errorf("--backup-every must be at least %s", backupMinInterval)
		}
		if opt.backup.push {
			opt.backup.git = true
		}
		abs, absErr := filepath.Abs(opt.backup.dir)
		if absErr != nil {
			return opt, fmt.Errorf("resolve backup dir: %w", absErr)
		}
		opt.backup.dir = abs
		opt.backup.firstRun = backupFirstDelay
	}
	if opt.localOnly && opt.networkConfig != "" {
		return opt, errors.New("--local-only and --network-config cannot be combined")
	}
	if opt.newAccount && opt.mnemonicFile != "" {
		return opt, errors.New("--new and --mnemonic-file cannot be combined")
	}
	if opt.dataDir == "" {
		dir, err := defaultServeDataDir()
		if err != nil {
			return opt, err
		}
		opt.dataDir = dir
	}
	abs, err := filepath.Abs(opt.dataDir)
	if err != nil {
		return opt, fmt.Errorf("resolve data dir: %w", err)
	}
	opt.dataDir = abs
	if opt.networkConfig != "" {
		if opt.networkConfig, err = filepath.Abs(opt.networkConfig); err != nil {
			return opt, fmt.Errorf("resolve network config: %w", err)
		}
		if _, err = os.Stat(opt.networkConfig); err != nil {
			return opt, fmt.Errorf("network config: %w", err)
		}
	}
	return opt, nil
}

// normalizeMnemonic collapses whatever whitespace the phrase arrived with
// (a trailing newline from a file, line wraps) into single spaces.
func normalizeMnemonic(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// resolveMnemonic finds the account's recovery phrase. source says where it
// came from; an empty phrase means none was supplied.
func resolveMnemonic(opt serveOptions, getenv func(string) string) (phrase, source string, err error) {
	if v := normalizeMnemonic(getenv("LOOM_MNEMONIC")); v != "" {
		return v, "LOOM_MNEMONIC", nil
	}
	if opt.mnemonicFile != "" {
		data, err := os.ReadFile(opt.mnemonicFile)
		if err != nil {
			return "", "", fmt.Errorf("read mnemonic file: %w", err)
		}
		v := normalizeMnemonic(string(data))
		if v == "" {
			return "", "", fmt.Errorf("mnemonic file %s is empty", opt.mnemonicFile)
		}
		return v, "--mnemonic-file", nil
	}
	remembered := filepath.Join(opt.dataDir, serveMnemonicFile)
	data, err := os.ReadFile(remembered)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", "", nil
		}
		return "", "", fmt.Errorf("read remembered mnemonic: %w", err)
	}
	if v := normalizeMnemonic(string(data)); v != "" {
		return v, remembered, nil
	}
	return "", "", nil
}

// rememberMnemonic stores the phrase in the data dir (0600 in a 0700 dir). It
// refuses to overwrite a different phrase: that would orphan the account.
func rememberMnemonic(dataDir, phrase string) error {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	path := filepath.Join(dataDir, serveMnemonicFile)
	if existing, err := os.ReadFile(path); err == nil {
		if normalizeMnemonic(string(existing)) == phrase {
			return nil
		}
		return fmt.Errorf("%s already holds a different recovery phrase", path)
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	if _, err = f.WriteString(phrase + "\n"); err != nil {
		f.Close()
		return fmt.Errorf("write %s: %w", path, err)
	}
	if err = f.Close(); err != nil {
		return fmt.Errorf("close %s: %w", path, err)
	}
	return nil
}

// serveAPIURL is the URL clients use for a listen address: a wildcard or
// empty host means "this machine".
func serveAPIURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "http://" + addr
	}
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}

// serveStep wraps a middleware response's own error field, which is where
// this API reports what actually went wrong.
func serveStep(step string, ok bool, desc string) error {
	if ok {
		return nil
	}
	return fmt.Errorf("%s: %s", step, desc)
}

// startServe brings the middleware up on the account and returns its id.
// phrase is empty when a new account is to be created; created is then the
// new phrase.
func startServe(ctx context.Context, mw serveMiddleware, opt serveOptions, phrase string, stderr io.Writer) (accountId, created string, err error) {
	init := mw.InitialSetParameters(ctx, &pb.RpcInitialSetParametersRequest{
		Platform:           serveClientPlatform,
		Version:            serveClientVersion,
		Workdir:            opt.dataDir,
		LogLevel:           os.Getenv("LOOM_LOG_LEVEL"),
		DoNotSendLogs:      true,
		DoNotSendTelemetry: true,
	})
	if e := init.GetError(); e.GetCode() != pb.RpcInitialSetParametersResponseError_NULL {
		return "", "", serveStep("initial parameters", false, e.GetDescription())
	}

	if phrase == "" {
		wallet := mw.WalletCreate(ctx, &pb.RpcWalletCreateRequest{RootPath: opt.dataDir})
		if e := wallet.GetError(); e.GetCode() != pb.RpcWalletCreateResponseError_NULL {
			return "", "", serveStep("create wallet", false, e.GetDescription())
		}
		created = normalizeMnemonic(wallet.GetMnemonic())
		if created == "" {
			return "", "", errors.New("create wallet: no recovery phrase returned")
		}
		// stored before the account exists, so a crash cannot leave an account whose phrase was never kept
		if err = rememberMnemonic(opt.dataDir, created); err != nil {
			return "", "", fmt.Errorf("keep recovery phrase: %w", err)
		}
		acc := mw.AccountCreate(ctx, &pb.RpcAccountCreateRequest{
			Name:                        opt.name,
			StorePath:                   opt.dataDir,
			NetworkMode:                 opt.networkMode(),
			NetworkCustomConfigFilePath: opt.networkConfig,
			DisableLocalNetworkSync:     opt.noLanSync,
			JsonApiListenAddr:           opt.apiAddr,
		})
		if e := acc.GetError(); e.GetCode() != pb.RpcAccountCreateResponseError_NULL {
			return "", "", serveStep("create account", false, fmt.Sprintf("%s: %s", e.GetCode(), e.GetDescription()))
		}
		if accountId = acc.GetAccount().GetId(); accountId == "" {
			return "", "", errors.New("create account: no account id returned")
		}
		return accountId, created, nil
	}

	rec := mw.WalletRecover(ctx, &pb.RpcWalletRecoverRequest{Mnemonic: phrase, RootPath: opt.dataDir})
	if e := rec.GetError(); e.GetCode() != pb.RpcWalletRecoverResponseError_NULL {
		return "", "", serveStep("recovery phrase", false, fmt.Sprintf("%s: %s", e.GetCode(), e.GetDescription()))
	}
	sess := mw.WalletCreateSession(ctx, &pb.RpcWalletCreateSessionRequest{
		Auth: &pb.RpcWalletCreateSessionRequestAuthOfMnemonic{Mnemonic: phrase},
	})
	if e := sess.GetError(); e.GetCode() != pb.RpcWalletCreateSessionResponseError_NULL {
		return "", "", serveStep("derive account", false, fmt.Sprintf("%s: %s", e.GetCode(), e.GetDescription()))
	}
	if accountId = sess.GetAccountId(); accountId == "" {
		return "", "", errors.New("derive account: no account id returned")
	}
	if _, statErr := os.Stat(filepath.Join(opt.dataDir, accountId)); errors.Is(statErr, os.ErrNotExist) {
		fmt.Fprintf(stderr, "first start for account %s: fetching its data from the network, this can take a while…\n", accountId)
	}
	sel := mw.AccountSelect(ctx, &pb.RpcAccountSelectRequest{
		Id:                          accountId,
		RootPath:                    opt.dataDir,
		DisableLocalNetworkSync:     opt.noLanSync,
		NetworkMode:                 opt.networkMode(),
		NetworkCustomConfigFilePath: opt.networkConfig,
		JsonApiListenAddr:           opt.apiAddr,
	})
	if e := sel.GetError(); e.GetCode() != pb.RpcAccountSelectResponseError_NULL {
		return "", "", serveStep("open account", false, fmt.Sprintf("%s: %s", e.GetCode(), e.GetDescription()))
	}
	return accountId, "", nil
}

// waitForAPI waits until something answers HTTP at baseURL. The middleware
// logs a failure to bind the listen address and carries on, so without this
// probe a busy port would look like a working server.
func waitForAPI(ctx context.Context, baseURL string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 5 * time.Second}
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/v2/auth/whoami", nil)
		if err != nil {
			return fmt.Errorf("build api probe: %w", err)
		}
		resp, err := client.Do(req)
		if err == nil {
			resp.Body.Close()
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the JSON API did not come up at %s within %s (is the port taken by another Loom?): %w", baseURL, timeout, err)
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for api: %w", ctx.Err())
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func keyAccepted(ctx context.Context, baseURL, key string) bool {
	var who v2model.WhoamiResponse
	return key != "" && authCall(ctx, baseURL, http.MethodGet, "/v2/auth/whoami", key, nil, &who) == nil
}

// keyReachesAllSpaces is keyAccepted plus a check that the key is not limited
// to a list of spaces. serve reuses the key saved in the CLI config, which may
// have been granted only some spaces; a backup run with it would silently skip
// every other space.
func keyReachesAllSpaces(ctx context.Context, baseURL, key string) bool {
	var who v2model.WhoamiResponse
	if key == "" || authCall(ctx, baseURL, http.MethodGet, "/v2/auth/whoami", key, nil, &who) != nil {
		return false
	}
	return !who.Grant.Restricted
}

// ensureAPIKey leaves the CLI config pointing at this server with a key it
// accepts: the saved one if it still works, otherwise a freshly minted one.
func ensureAPIKey(ctx context.Context, mw serveMiddleware, baseURL string) (key string, minted bool, err error) {
	cfg := loadConfig()
	if cfg.ApiUrl == baseURL && keyReachesAllSpaces(ctx, baseURL, cfg.ApiKey) {
		return cfg.ApiKey, false, nil
	}
	resp := mw.AccountLocalLinkCreateApp(ctx, &pb.RpcAccountLocalLinkCreateAppRequest{
		App: &model.AccountAuthAppInfo{AppName: serveAppName, Scope: model.AccountAuth_JsonAPI},
	})
	if e := resp.GetError(); e.GetCode() != pb.RpcAccountLocalLinkCreateAppResponseError_NULL {
		return "", false, serveStep("create api key", false, e.GetDescription())
	}
	key = resp.GetAppKey()
	if key == "" {
		return "", false, errors.New("create api key: no key returned")
	}
	if !keyAccepted(ctx, baseURL, key) {
		return "", false, fmt.Errorf("the API at %s did not accept the new key — is another Loom or app already using that address?", baseURL)
	}
	cfg.ApiKey, cfg.ApiUrl = key, baseURL
	if err = saveConfig(cfg); err != nil {
		return "", false, fmt.Errorf("save api key: %w", err)
	}
	return key, true, nil
}

func runServe(argv []string, stdin io.Reader, stdout, stderr io.Writer) int {
	opt, err := parseServeFlags(argv, stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		fmt.Fprintln(stderr, "error:", err)
		return 2
	}

	phrase, source, err := resolveMnemonic(opt, os.Getenv)
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	switch {
	case opt.newAccount && phrase != "":
		fmt.Fprintf(stderr, "error: --new, but an account already exists here (phrase from %s) — run without --new\n", source)
		return 2
	case !opt.newAccount && phrase == "":
		fmt.Fprintln(stderr, "error: no account — pass --new to create one, or give an existing recovery phrase with LOOM_MNEMONIC or --mnemonic-file")
		fmt.Fprintln(stderr, serveUsage)
		return 2
	}
	if err = os.MkdirAll(opt.dataDir, 0o700); err != nil {
		fmt.Fprintln(stderr, "error: create data dir:", err)
		return 1
	}
	if phrase != "" && opt.remember {
		if err = rememberMnemonic(opt.dataDir, phrase); err != nil {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	mw := core.New()
	mw.SetEventSender(event.NewCallbackSender(func(*pb.Event) {}))
	api.SetMiddlewareParams(mw)

	accountId, created, err := startServe(ctx, mw, opt, phrase, stderr)
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		mw.AppShutdown(context.Background(), &pb.RpcAppShutdownRequest{})
		return 1
	}
	defer mw.AppShutdown(context.Background(), &pb.RpcAppShutdownRequest{})

	if created != "" {
		fmt.Fprintln(stderr, "\nRecovery phrase of the new account — it is the only way to sign in to it from the desktop app,")
		fmt.Fprintln(stderr, "so write it down. It is also stored, readable by you only, at "+filepath.Join(opt.dataDir, serveMnemonicFile)+".")
		fmt.Fprintln(stderr, "\n  "+created+"\n")
	}

	baseURL := serveAPIURL(opt.apiAddr)
	if err = waitForAPI(ctx, baseURL, serveAPITimeout); err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	key, _, err := ensureAPIKey(ctx, mw, baseURL)
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	cfgPath, _ := configPath()

	fmt.Fprintf(stdout, "loom serve is running\n")
	fmt.Fprintf(stdout, "account: %s\n", accountId)
	fmt.Fprintf(stdout, "network: %s\n", opt.networkLabel())
	fmt.Fprintf(stdout, "data:    %s\n", opt.dataDir)
	fmt.Fprintf(stdout, "api:     %s (key saved in %s — the other loom verbs use it)\n", baseURL, cfgPath)
	if opt.localOnly {
		fmt.Fprintln(stdout, "sync is off (--local-only); this server's data will not reach other devices")
	} else {
		fmt.Fprintln(stdout, "sign in to this account in the desktop app with the recovery phrase to sync with it; Ctrl-C to stop")
	}

	if opt.backup.dir != "" {
		fmt.Fprintf(stdout, "backup:  Markdown export of every space into %s every %s", opt.backup.dir, opt.backup.every)
		switch {
		case opt.backup.push:
			fmt.Fprintln(stdout, ", committed and pushed (use a private repository)")
		case opt.backup.git:
			fmt.Fprintln(stdout, ", committed to git")
		default:
			fmt.Fprintln(stdout)
		}
		go backupLoop(ctx, mw, baseURL, key, opt.backup, stderr)
	}

	<-ctx.Done()
	fmt.Fprintln(stdout, "shutting down…")
	return 0
}
