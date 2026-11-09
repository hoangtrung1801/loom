package main

// backup.go — Markdown backups for loom serve. On a schedule it exports every
// space the server holds to Markdown, lays each one into a fixed folder of a
// backup directory, and, when asked, commits the changes to git and pushes
// them, so a GitHub repository keeps a readable copy of the data.
//
//	loom serve --backup-dir ~/loom-backup --backup-git --backup-push
//
// The middleware's export writes into a new timestamped folder every time,
// which would make every run one big diff. So each space is exported into a
// scratch folder and then copied over its stable folder in the backup
// directory (<space name>-<id tail>); only real changes reach git.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	v2model "github.com/hoangtrung1801/loom/loom-heart/core/api/v2/model"
	"github.com/hoangtrung1801/loom/loom-heart/pb"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
)

const (
	// backupFirstDelay gives a first start time to pull the account's data
	// from the network before the first export runs.
	backupFirstDelay    = time.Minute
	backupMinInterval   = time.Minute
	backupSpacesFolder  = "spaces"
	backupCommitMessage = "Loom export"
)

type backupOptions struct {
	dir      string
	every    time.Duration
	git      bool
	push     bool
	remote   string
	firstRun time.Duration // delay before the first run; tests set it small
}

// backupExporter is the middleware's export call.
type backupExporter interface {
	ObjectListExport(ctx context.Context, req *pb.RpcObjectListExportRequest) *pb.RpcObjectListExportResponse
}

type backupSpace struct {
	id   string
	name string
}

// spaceListing returns the spaces the API key can see, with full ids.
func listBackupSpaces(ctx context.Context, baseURL, key string, log io.Writer) ([]backupSpace, error) {
	var out []backupSpace
	warned := false
	for offset := 0; ; {
		var page v2model.ListSpacesResponse
		path := fmt.Sprintf("/v2/spaces?ids=full&limit=100&offset=%d", offset)
		if err := authCall(ctx, baseURL, http.MethodGet, path, key, nil, &page); err != nil {
			return nil, fmt.Errorf("list spaces: %w", err)
		}
		if page.HasNotGrantedSpaces && !warned {
			warned = true
			fmt.Fprintln(log, "backup: warning: the API key is not granted every space, so some spaces are not backed up")
		}
		for _, s := range page.Data {
			out = append(out, backupSpace{id: s.Id, name: s.Name})
		}
		if !page.HasMore || len(page.Data) == 0 {
			return out, nil
		}
		offset += len(page.Data)
	}
}

var backupSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

// backupFolderName is the stable folder for a space: its name plus the tail
// of its id, so renaming a space moves the folder but two spaces with the
// same name never collide. The tail comes from the CID half of the id only: a
// full space id is "<cid>.<replication key>" and every space on an account
// shares the replication key, so a tail taken from the end of the whole id
// would be the same for all spaces.
func backupFolderName(s backupSpace) string {
	name := strings.Trim(backupSlugRe.ReplaceAllString(strings.ToLower(s.name), "-"), "-")
	if len(name) > 40 {
		name = strings.TrimRight(name[:40], "-")
	}
	tail := s.id
	if dot := strings.IndexByte(tail, '.'); dot > 0 {
		tail = tail[:dot]
	}
	if len(tail) > 8 {
		tail = tail[len(tail)-8:]
	}
	tail = strings.Trim(backupSlugRe.ReplaceAllString(strings.ToLower(tail), "-"), "-")
	if name == "" {
		return "space-" + tail
	}
	return name + "-" + tail
}

// exportSpace exports one space to Markdown into target, replacing what was
// there. An export that produced nothing leaves target alone: an account that
// is still syncing must not empty a backup.
func exportSpace(ctx context.Context, mw backupExporter, s backupSpace, target string) (int, error) {
	scratch, err := os.MkdirTemp("", "loom-export-")
	if err != nil {
		return 0, fmt.Errorf("create scratch dir: %w", err)
	}
	defer os.RemoveAll(scratch)

	resp := mw.ObjectListExport(ctx, &pb.RpcObjectListExportRequest{
		SpaceId:                      s.id,
		Path:                         scratch,
		Format:                       model.Export_Markdown,
		IncludeFiles:                 true,
		NoProgress:                   true,
		MdIncludePropertiesAndSchema: true,
	})
	if e := resp.GetError(); e.GetCode() != pb.RpcObjectListExportResponseError_NULL {
		return 0, fmt.Errorf("export space %q: %s", s.name, e.GetDescription())
	}
	src := resp.GetPath()
	if src == "" {
		return 0, fmt.Errorf("export space %q: no output path", s.name)
	}
	count, err := countFiles(src)
	if err != nil {
		return 0, fmt.Errorf("read export of space %q: %w", s.name, err)
	}
	if count == 0 {
		return 0, nil
	}
	if err = replaceDir(src, target); err != nil {
		return 0, fmt.Errorf("write backup of space %q: %w", s.name, err)
	}
	removeRenamedFolders(target)
	return count, nil
}

// removeRenamedFolders drops the folders an earlier name of the same space
// left behind: they share the id tail that ends every folder name.
func removeRenamedFolders(target string) {
	base := filepath.Base(target)
	tail := base[strings.LastIndex(base, "-")+1:]
	if tail == "" {
		return
	}
	matches, _ := filepath.Glob(filepath.Join(filepath.Dir(target), "*-"+tail))
	for _, m := range matches {
		if m != target {
			os.RemoveAll(m)
		}
	}
}

func countFiles(dir string) (int, error) {
	n := 0
	err := filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type().IsRegular() {
			n++
		}
		return nil
	})
	return n, err
}

// replaceDir makes dst a copy of src. dst is built beside the old one and
// swapped in, so a failure half way leaves the previous backup intact.
func replaceDir(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("create backup dir: %w", err)
	}
	next := dst + ".new"
	if err := os.RemoveAll(next); err != nil {
		return fmt.Errorf("clear %s: %w", next, err)
	}
	if err := copyTree(src, next); err != nil {
		os.RemoveAll(next)
		return err
	}
	if err := os.RemoveAll(dst); err != nil {
		os.RemoveAll(next)
		return fmt.Errorf("remove old %s: %w", dst, err)
	}
	if err := os.Rename(next, dst); err != nil {
		return fmt.Errorf("move %s into place: %w", next, err)
	}
	return nil
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return fmt.Errorf("relative path: %w", err)
		}
		out := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(out, 0o755)
		}
		if !d.Type().IsRegular() {
			return nil
		}
		in, err := os.Open(p)
		if err != nil {
			return fmt.Errorf("open %s: %w", p, err)
		}
		defer in.Close()
		f, err := os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
		if err != nil {
			return fmt.Errorf("create %s: %w", out, err)
		}
		if _, err = io.Copy(f, in); err != nil {
			f.Close()
			return fmt.Errorf("copy %s: %w", p, err)
		}
		return f.Close()
	})
}

// gitRunner runs git in dir; a variable so tests can use a fake.
type gitRunner func(ctx context.Context, dir string, args ...string) (string, error)

func runGit(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	// never wait on a credential prompt in a background job
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		return text, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, text)
	}
	return text, nil
}

// commitBackup commits whatever changed in dir and, with push, pushes it.
// It reports whether a commit was made.
func commitBackup(ctx context.Context, git gitRunner, dir string, opt backupOptions, now time.Time) (bool, error) {
	if _, err := git(ctx, dir, "rev-parse", "--git-dir"); err != nil {
		if _, err = git(ctx, dir, "init", "-b", "main"); err != nil {
			return false, fmt.Errorf("init repository: %w", err)
		}
	}
	if opt.remote != "" {
		if _, err := git(ctx, dir, "remote", "get-url", "origin"); err != nil {
			if _, err = git(ctx, dir, "remote", "add", "origin", opt.remote); err != nil {
				return false, fmt.Errorf("add remote: %w", err)
			}
		}
	}
	if _, err := git(ctx, dir, "add", "-A"); err != nil {
		return false, fmt.Errorf("stage backup: %w", err)
	}
	committed := false
	_, diffErr := git(ctx, dir, "diff", "--cached", "--quiet")
	var exitErr *exec.ExitError
	if diffErr != nil && !(errors.As(diffErr, &exitErr) && exitErr.ExitCode() == 1) {
		return false, fmt.Errorf("check staged changes: %w", diffErr)
	}
	if diffErr != nil {
		// exit status 1 means there are staged changes
		args := []string{}
		if name, _ := git(ctx, dir, "config", "user.name"); name == "" {
			args = append(args, "-c", "user.name=Loom")
		}
		if mail, _ := git(ctx, dir, "config", "user.email"); mail == "" {
			args = append(args, "-c", "user.email=loom@localhost")
		}
		args = append(args, "commit", "-q", "-m", backupCommitMessage+" "+now.Format("2006-01-02 15:04"))
		if _, err := git(ctx, dir, args...); err != nil {
			return false, fmt.Errorf("commit backup: %w", err)
		}
		committed = true
	}
	if opt.push {
		if _, err := git(ctx, dir, "push", "-u", "origin", "HEAD"); err != nil {
			return committed, fmt.Errorf("push backup: %w", err)
		}
	}
	return committed, nil
}

// runBackup does one backup pass over spaces: export each, then commit. Space
// failures are collected so one bad space does not stop the others.
func runBackup(ctx context.Context, mw backupExporter, spaces []backupSpace, opt backupOptions, git gitRunner, now time.Time, log io.Writer) error {
	var errs []error
	exported := 0
	for _, s := range spaces {
		count, err := exportSpace(ctx, mw, s, filepath.Join(opt.dir, backupSpacesFolder, backupFolderName(s)))
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if count == 0 {
			fmt.Fprintf(log, "backup: space %q exported no objects yet — left as it was\n", s.name)
			continue
		}
		exported++
	}
	if opt.git || opt.push {
		committed, err := commitBackup(ctx, git, opt.dir, opt, now)
		if err != nil {
			errs = append(errs, err)
		} else if committed {
			fmt.Fprintf(log, "backup: committed changes from %d space(s)\n", exported)
		} else {
			fmt.Fprintf(log, "backup: no changes in %d space(s)\n", exported)
		}
	}
	return errors.Join(errs...)
}

// backupLoop runs backups until ctx ends: first after a short delay, then
// every opt.every. Failures are logged and retried at the next tick.
func backupLoop(ctx context.Context, mw backupExporter, baseURL, key string, opt backupOptions, log io.Writer) {
	delay := opt.firstRun
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		spaces, err := listBackupSpaces(ctx, baseURL, key, log)
		if err == nil {
			err = runBackup(ctx, mw, spaces, opt, runGit, time.Now(), log)
		}
		if err != nil && ctx.Err() == nil {
			fmt.Fprintf(log, "backup: error: %v\n", err)
		}
		delay = opt.every
	}
}
