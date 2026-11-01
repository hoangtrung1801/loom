package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEmbeddedSkill(t *testing.T) {
	assert.True(t, isLoomSkill(skillText), "the embedded SKILL.md must carry name: loom")
	assert.NotContains(t, skillText, "Anytype")
}

func TestParseSkillFlags(t *testing.T) {
	t.Run("defaults to claude", func(t *testing.T) {
		got, err := parseSkillFlags("install", nil, &bytes.Buffer{})

		require.NoError(t, err)
		assert.Equal(t, []string{"claude"}, got.agents)
	})

	t.Run("agent list", func(t *testing.T) {
		got, err := parseSkillFlags("install", []string{"--agent", "Claude, codex"}, &bytes.Buffer{})

		require.NoError(t, err)
		assert.Equal(t, []string{"claude", "codex"}, got.agents)
	})

	for name, argv := range map[string][]string{
		"unknown agent":    {"--agent", "emacs"},
		"dir with agent":   {"--dir", "/x", "--agent", "claude"},
		"dir with project": {"--dir", "/x", "--project"},
		"stray argument":   {"extra"},
	} {
		t.Run("rejects "+name, func(t *testing.T) {
			_, err := parseSkillFlags("install", argv, &bytes.Buffer{})

			assert.Error(t, err)
		})
	}
}

func TestSkillTargets(t *testing.T) {
	noEnv := func(string) string { return "" }

	t.Run("user level", func(t *testing.T) {
		got, err := skillTargets(skillOptions{agents: []string{"claude", "codex"}}, noEnv, "/h", "/cwd")

		require.NoError(t, err)
		assert.Equal(t, []skillTarget{
			{label: "claude", path: "/h/.claude/skills/loom/SKILL.md"},
			{label: "codex", path: "/h/.codex/skills/loom/SKILL.md"},
		}, got)
	})

	t.Run("config dir variables win", func(t *testing.T) {
		env := func(k string) string {
			return map[string]string{"CLAUDE_CONFIG_DIR": "/cc", "CODEX_HOME": "/cx"}[k]
		}

		got, err := skillTargets(skillOptions{agents: []string{"claude", "codex"}}, env, "/h", "/cwd")

		require.NoError(t, err)
		assert.Equal(t, "/cc/skills/loom/SKILL.md", got[0].path)
		assert.Equal(t, "/cx/skills/loom/SKILL.md", got[1].path)
	})

	t.Run("project level", func(t *testing.T) {
		got, err := skillTargets(skillOptions{agents: []string{"claude"}, project: true}, noEnv, "/h", "/cwd")

		require.NoError(t, err)
		assert.Equal(t, "/cwd/.claude/skills/loom/SKILL.md", got[0].path)
	})

	t.Run("explicit dir", func(t *testing.T) {
		got, err := skillTargets(skillOptions{dir: "/some/skills"}, noEnv, "/h", "/cwd")

		require.NoError(t, err)
		assert.Equal(t, "/some/skills/loom/SKILL.md", got[0].path)
	})

	t.Run("no home directory", func(t *testing.T) {
		_, err := skillTargets(skillOptions{agents: []string{"claude"}}, noEnv, "", "/cwd")

		assert.Error(t, err)
	})
}

func TestInstallSkill(t *testing.T) {
	t.Run("installs, then reports unchanged", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "deep", "loom", "SKILL.md")

		state, err := installSkill(path, false)
		require.NoError(t, err)
		assert.Equal(t, "installed", state)
		data, err := os.ReadFile(path)
		require.NoError(t, err)
		assert.Equal(t, skillText, string(data))

		state, err = installSkill(path, false)
		require.NoError(t, err)
		assert.Equal(t, "unchanged", state)
	})

	t.Run("updates an older loom skill", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "SKILL.md")
		require.NoError(t, os.WriteFile(path, []byte("---\nname: loom\n---\nold\n"), 0o644))

		state, err := installSkill(path, false)

		require.NoError(t, err)
		assert.Equal(t, "updated", state)
		data, _ := os.ReadFile(path)
		assert.Equal(t, skillText, string(data))
	})

	t.Run("refuses someone else's file unless forced", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "SKILL.md")
		other := "---\nname: other\n---\nmine\n"
		require.NoError(t, os.WriteFile(path, []byte(other), 0o644))

		_, err := installSkill(path, false)
		require.Error(t, err)
		data, _ := os.ReadFile(path)
		assert.Equal(t, other, string(data))

		state, err := installSkill(path, true)
		require.NoError(t, err)
		assert.Equal(t, "updated", state)
	})
}

func TestUninstallSkill(t *testing.T) {
	t.Run("removes the skill and its empty folder", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom")
		path := filepath.Join(dir, "SKILL.md")
		_, err := installSkill(path, false)
		require.NoError(t, err)

		state, err := uninstallSkill(path)

		require.NoError(t, err)
		assert.Equal(t, "removed", state)
		assert.NoFileExists(t, path)
		assert.NoDirExists(t, dir)
	})

	t.Run("missing is not an error", func(t *testing.T) {
		state, err := uninstallSkill(filepath.Join(t.TempDir(), "loom", "SKILL.md"))

		require.NoError(t, err)
		assert.Equal(t, "not installed", state)
	})

	t.Run("leaves a different skill alone", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "SKILL.md")
		require.NoError(t, os.WriteFile(path, []byte("---\nname: other\n---\n"), 0o644))

		_, err := uninstallSkill(path)

		require.Error(t, err)
		assert.FileExists(t, path)
	})
}

func TestRunSkill(t *testing.T) {
	t.Run("install for claude under HOME, then uninstall", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("HOME", home)
		t.Setenv("USERPROFILE", home)
		t.Setenv("CLAUDE_CONFIG_DIR", "")
		var stdout, stderr bytes.Buffer

		code := runSkill([]string{"install"}, &stdout, &stderr)

		require.Equal(t, 0, code, stderr.String())
		assert.FileExists(t, filepath.Join(home, ".claude", "skills", "loom", "SKILL.md"))
		assert.Contains(t, stdout.String(), "claude: installed")

		stdout.Reset()
		code = runSkill([]string{"uninstall"}, &stdout, &stderr)

		require.Equal(t, 0, code, stderr.String())
		assert.NoFileExists(t, filepath.Join(home, ".claude", "skills", "loom", "SKILL.md"))
	})

	t.Run("print writes the skill", func(t *testing.T) {
		var stdout bytes.Buffer

		code := runSkill([]string{"print"}, &stdout, &bytes.Buffer{})

		assert.Equal(t, 0, code)
		assert.Equal(t, skillText, stdout.String())
	})

	t.Run("unknown subcommand", func(t *testing.T) {
		assert.Equal(t, 2, runSkill([]string{"frobnicate"}, &bytes.Buffer{}, &bytes.Buffer{}))
	})

	t.Run("a write failure is reported with exit 1", func(t *testing.T) {
		dir := t.TempDir()
		blocked := filepath.Join(dir, "loom")
		require.NoError(t, os.MkdirAll(filepath.Join(blocked, "SKILL.md"), 0o755)) // a directory where the file should go
		var stdout, stderr bytes.Buffer

		code := runSkill([]string{"install", "--dir", dir}, &stdout, &stderr)

		assert.Equal(t, 1, code)
		assert.Contains(t, stderr.String(), "error")
	})
}
