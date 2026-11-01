package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/hoangtrung1801/loom/loom-heart/pb"
)

// fakeExporter writes the files its test names into a timestamped-looking
// folder under the requested path, like the real export does.
type fakeExporter struct {
	files map[string]map[string]string // space id -> relative path -> content
	fail  map[string]bool
	calls []*pb.RpcObjectListExportRequest
}

func (f *fakeExporter) ObjectListExport(_ context.Context, req *pb.RpcObjectListExportRequest) *pb.RpcObjectListExportResponse {
	f.calls = append(f.calls, req)
	if f.fail[req.SpaceId] {
		return &pb.RpcObjectListExportResponse{Error: &pb.RpcObjectListExportResponseError{
			Code: pb.RpcObjectListExportResponseError_UNKNOWN_ERROR, Description: "boom",
		}}
	}
	out := filepath.Join(req.Path, "anytype-export-2026-01-01-000000.000")
	if err := os.MkdirAll(out, 0o755); err != nil {
		panic(err)
	}
	for rel, content := range f.files[req.SpaceId] {
		p := filepath.Join(out, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			panic(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			panic(err)
		}
	}
	return &pb.RpcObjectListExportResponse{Path: out, Error: &pb.RpcObjectListExportResponseError{}}
}

func TestBackupFolderName(t *testing.T) {
	for want, s := range map[string]backupSpace{
		"my-notes-abcd1234": {id: "bafyreiXabcd1234", name: "My Notes!"},
		"space-abcd1234":    {id: "bafyreiXabcd1234", name: "???"},
		"short-id":          {id: "id", name: "Short"},
	} {
		assert.Equal(t, want, backupFolderName(s))
	}
}

func TestExportSpace(t *testing.T) {
	ctx := context.Background()

	t.Run("exports markdown with files and replaces the old folder", func(t *testing.T) {
		target := filepath.Join(t.TempDir(), "spaces", "notes-1234")
		require.NoError(t, os.MkdirAll(target, 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(target, "deleted.md"), []byte("gone"), 0o644))
		fx := &fakeExporter{files: map[string]map[string]string{"s1": {"A.md": "# A", "files/pic.png": "png"}}}

		count, err := exportSpace(ctx, fx, backupSpace{id: "s1", name: "Notes"}, target)

		require.NoError(t, err)
		assert.Equal(t, 2, count)
		assert.FileExists(t, filepath.Join(target, "A.md"))
		assert.FileExists(t, filepath.Join(target, "files", "pic.png"))
		assert.NoFileExists(t, filepath.Join(target, "deleted.md"))
		assert.NoDirExists(t, target+".new")
		req := fx.calls[0]
		assert.Equal(t, "s1", req.SpaceId)
		assert.True(t, req.IncludeFiles)
		assert.True(t, req.MdIncludePropertiesAndSchema)
		assert.False(t, req.Zip)
		assert.Equal(t, int32(0), int32(req.Format), "format must be Markdown")
	})

	t.Run("an empty export leaves the backup alone", func(t *testing.T) {
		target := filepath.Join(t.TempDir(), "spaces", "notes-1234")
		require.NoError(t, os.MkdirAll(target, 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(target, "A.md"), []byte("keep"), 0o644))
		fx := &fakeExporter{files: map[string]map[string]string{"s1": {}}}

		count, err := exportSpace(ctx, fx, backupSpace{id: "s1", name: "Notes"}, target)

		require.NoError(t, err)
		assert.Zero(t, count)
		data, err := os.ReadFile(filepath.Join(target, "A.md"))
		require.NoError(t, err)
		assert.Equal(t, "keep", string(data))
	})

	t.Run("an export error leaves the backup alone", func(t *testing.T) {
		target := filepath.Join(t.TempDir(), "spaces", "notes-1234")
		require.NoError(t, os.MkdirAll(target, 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(target, "A.md"), []byte("keep"), 0o644))
		fx := &fakeExporter{fail: map[string]bool{"s1": true}}

		_, err := exportSpace(ctx, fx, backupSpace{id: "s1", name: "Notes"}, target)

		require.Error(t, err)
		assert.FileExists(t, filepath.Join(target, "A.md"))
	})

	t.Run("a renamed space does not leave its old folder behind", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "spaces")
		fx := &fakeExporter{files: map[string]map[string]string{"bafyXabcd1234": {"A.md": "# A"}}}
		old := backupSpace{id: "bafyXabcd1234", name: "Old name"}
		renamed := backupSpace{id: "bafyXabcd1234", name: "New name"}
		other := backupSpace{id: "bafyXzzzz9999", name: "Other"}
		fx.files["bafyXzzzz9999"] = map[string]string{"B.md": "# B"}

		_, err := exportSpace(ctx, fx, old, filepath.Join(root, backupFolderName(old)))
		require.NoError(t, err)
		_, err = exportSpace(ctx, fx, other, filepath.Join(root, backupFolderName(other)))
		require.NoError(t, err)
		_, err = exportSpace(ctx, fx, renamed, filepath.Join(root, backupFolderName(renamed)))
		require.NoError(t, err)

		assert.NoDirExists(t, filepath.Join(root, backupFolderName(old)))
		assert.DirExists(t, filepath.Join(root, backupFolderName(renamed)))
		assert.DirExists(t, filepath.Join(root, backupFolderName(other)))
	})
}

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, string(out))
	return strings.TrimSpace(string(out))
}

func TestRunBackupWithGit(t *testing.T) {
	ctx := context.Background()
	t.Setenv("GIT_CONFIG_GLOBAL", "/dev/null") // no user identity: the backup must supply one
	t.Setenv("GIT_CONFIG_SYSTEM", "/dev/null")
	remote := filepath.Join(t.TempDir(), "remote.git")
	gitIn(t, filepath.Dir(remote), "init", "--bare", "-b", "main", remote)
	opt := backupOptions{dir: filepath.Join(t.TempDir(), "backup"), git: true, push: true, remote: remote}
	fx := &fakeExporter{files: map[string]map[string]string{"s1": {"A.md": "# A"}}}
	spaces := []backupSpace{{id: "s1", name: "Notes"}}
	var log bytes.Buffer
	now := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)

	t.Run("first run initialises, commits and pushes", func(t *testing.T) {
		require.NoError(t, runBackup(ctx, fx, spaces, opt, runGit, now, &log))

		assert.Contains(t, log.String(), "committed")
		assert.Equal(t, "Loom export 2026-11-01 10:00", gitIn(t, opt.dir, "log", "-1", "--format=%s"))
		assert.Equal(t, gitIn(t, opt.dir, "rev-parse", "HEAD"), gitIn(t, remote, "rev-parse", "main"))
		assert.Equal(t, "# A", gitIn(t, remote, "show", "main:spaces/notes-s1/A.md"))
	})

	t.Run("an unchanged export makes no commit", func(t *testing.T) {
		log.Reset()
		before := gitIn(t, opt.dir, "rev-parse", "HEAD")

		require.NoError(t, runBackup(ctx, fx, spaces, opt, runGit, now.Add(time.Hour), &log))

		assert.Contains(t, log.String(), "no changes")
		assert.Equal(t, before, gitIn(t, opt.dir, "rev-parse", "HEAD"))
	})

	t.Run("a change and a deletion are committed and pushed", func(t *testing.T) {
		log.Reset()
		fx.files["s1"] = map[string]string{"B.md": "# B"}

		require.NoError(t, runBackup(ctx, fx, spaces, opt, runGit, now.Add(2*time.Hour), &log))

		assert.Equal(t, "# B", gitIn(t, remote, "show", "main:spaces/notes-s1/B.md"))
		files := gitIn(t, remote, "ls-tree", "-r", "--name-only", "main")
		assert.NotContains(t, files, "A.md")
		assert.Equal(t, "2", gitIn(t, opt.dir, "rev-list", "--count", "HEAD"))
	})

	t.Run("one failing space does not stop the others", func(t *testing.T) {
		fx.fail = map[string]bool{"s2": true}
		fx.files["s3"] = map[string]string{"C.md": "# C"}
		two := []backupSpace{{id: "s2", name: "Bad"}, {id: "s3", name: "Good"}}

		err := runBackup(ctx, fx, two, opt, runGit, now.Add(3*time.Hour), &log)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "boom")
		assert.Equal(t, "# C", gitIn(t, remote, "show", "main:spaces/good-s3/C.md"))
	})
}

func TestRunBackupWithoutGit(t *testing.T) {
	opt := backupOptions{dir: filepath.Join(t.TempDir(), "backup")}
	fx := &fakeExporter{files: map[string]map[string]string{"s1": {"A.md": "# A"}}}

	err := runBackup(context.Background(), fx, []backupSpace{{id: "s1", name: "Notes"}}, opt, runGit, time.Now(), &bytes.Buffer{})

	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(opt.dir, "spaces", "notes-s1", "A.md"))
	assert.NoDirExists(t, filepath.Join(opt.dir, ".git"))
}

func TestListBackupSpaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer k", r.Header.Get("Authorization"))
		assert.Equal(t, "full", r.URL.Query().Get("ids"))
		page := map[string]any{"data": []map[string]string{{"id": "full-1", "name": "One"}}, "has_more": false}
		if r.URL.Query().Get("offset") == "0" {
			page = map[string]any{"data": []map[string]string{{"id": "full-1", "name": "One"}}, "has_more": true}
		} else {
			page = map[string]any{"data": []map[string]string{{"id": "full-2", "name": "Two"}}, "has_more": false}
		}
		_ = json.NewEncoder(w).Encode(page)
	}))
	defer srv.Close()

	got, err := listBackupSpaces(context.Background(), srv.URL, "k")

	require.NoError(t, err)
	assert.Equal(t, []backupSpace{{id: "full-1", name: "One"}, {id: "full-2", name: "Two"}}, got)
}

func TestParseServeBackupFlags(t *testing.T) {
	data := t.TempDir()

	t.Run("push implies git and defaults to hourly", func(t *testing.T) {
		got, err := parseServeFlags([]string{"--data-dir", data, "--backup-dir", "bk", "--backup-push"}, &bytes.Buffer{})

		require.NoError(t, err)
		assert.True(t, got.backup.git)
		assert.True(t, got.backup.push)
		assert.Equal(t, time.Hour, got.backup.every)
		assert.True(t, filepath.IsAbs(got.backup.dir))
	})

	for name, argv := range map[string][]string{
		"git without dir":    {"--backup-git"},
		"remote without dir": {"--backup-remote", "x"},
		"interval too short": {"--backup-dir", "bk", "--backup-every", "10s"},
	} {
		t.Run("rejects "+name, func(t *testing.T) {
			_, err := parseServeFlags(append([]string{"--data-dir", data}, argv...), &bytes.Buffer{})

			assert.Error(t, err)
		})
	}
}
