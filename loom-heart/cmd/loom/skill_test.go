package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEmbeddedSkill(t *testing.T) {
	assert.True(t, isSkillNamed(skillText, "loom"), "the embedded SKILL.md must carry name: loom")
	assert.NotContains(t, skillText, "Anytype")
}

func TestEmbeddedProjectManagementSkill(t *testing.T) {
	t.Run("SKILL.md carries the skill name", func(t *testing.T) {
		assert.True(t, isSkillNamed(pmSkillText, "loom-project-management"))
		assert.False(t, isSkillNamed(pmSkillText, "loom"))
	})

	t.Run("script starts with a bash shebang", func(t *testing.T) {
		assert.True(t, strings.HasPrefix(pmScriptText, "#!/usr/bin/env bash"))
	})

	t.Run("SKILL.md does not hard-code the repo path of the script", func(t *testing.T) {
		assert.NotContains(t, pmSkillText, "`.claude/skills/loom-project-management/scripts/loom-pm.sh")
		assert.Contains(t, pmSkillText, "`scripts/loom-pm.sh ")
	})
}

// The repo-level copy under .claude/skills is what people edit; the embedded
// one is what ships. They must not drift apart.
func TestEmbeddedProjectManagementSkillMatchesRepoCopy(t *testing.T) {
	repoDir := filepath.Join("..", "..", "..", ".claude", "skills", "loom-project-management")
	for name, want := range map[string]string{
		"SKILL.md":           pmSkillText,
		"scripts/loom-pm.sh": pmScriptText,
	} {
		t.Run("given the repo copy of "+name+" when compared then it equals the embedded one", func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(repoDir, filepath.FromSlash(name)))
			if errors.Is(err, os.ErrNotExist) {
				t.Skipf("no repo-level copy at %s", repoDir)
			}
			require.NoError(t, err)

			assert.Equal(t, want, string(data))
		})
	}
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

	t.Run("project management is on by default and can be switched off", func(t *testing.T) {
		got, err := parseSkillFlags("install", nil, &bytes.Buffer{})
		require.NoError(t, err)
		assert.False(t, got.noProjectManagement)

		got, err = parseSkillFlags("uninstall", []string{"--no-project-management"}, &bytes.Buffer{})
		require.NoError(t, err)
		assert.True(t, got.noProjectManagement)
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

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	return string(data)
}

func TestInstallSkill(t *testing.T) {
	t.Run("given an empty root when installing the loom skill then it is installed, then unchanged", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "deep", "loom")

		state, err := installSkill(loomSkill, dir, false)
		require.NoError(t, err)
		assert.Equal(t, "installed", state)
		assert.Equal(t, skillText, readFile(t, filepath.Join(dir, "SKILL.md")))

		state, err = installSkill(loomSkill, dir, false)
		require.NoError(t, err)
		assert.Equal(t, "unchanged", state)
	})

	t.Run("given an older loom skill when installing then it is updated", func(t *testing.T) {
		dir := t.TempDir()
		require.NoError(t, os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: loom\n---\nold\n"), 0o644))

		state, err := installSkill(loomSkill, dir, false)

		require.NoError(t, err)
		assert.Equal(t, "updated", state)
		assert.Equal(t, skillText, readFile(t, filepath.Join(dir, "SKILL.md")))
	})

	t.Run("given someone else's file when installing then it is refused unless forced", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "SKILL.md")
		other := "---\nname: other\n---\nmine\n"
		require.NoError(t, os.WriteFile(path, []byte(other), 0o644))

		_, err := installSkill(loomSkill, dir, false)
		require.Error(t, err)
		assert.Equal(t, other, readFile(t, path))

		state, err := installSkill(loomSkill, dir, true)
		require.NoError(t, err)
		assert.Equal(t, "updated", state)
	})

	t.Run("given an empty root when installing the project-management skill then SKILL.md and the executable script are written", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom-project-management")
		script := filepath.Join(dir, "scripts", "loom-pm.sh")

		state, err := installSkill(pmSkill, dir, false)

		require.NoError(t, err)
		assert.Equal(t, "installed", state)
		assert.Equal(t, pmSkillText, readFile(t, filepath.Join(dir, "SKILL.md")))
		assert.Equal(t, pmScriptText, readFile(t, script))
		info, err := os.Stat(script)
		require.NoError(t, err)
		assert.NotZero(t, info.Mode().Perm()&0o111, "the script must be executable")
		assert.Equal(t, os.FileMode(0o755), info.Mode().Perm())
		info, err = os.Stat(filepath.Join(dir, "SKILL.md"))
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o644), info.Mode().Perm())
	})

	t.Run("given an installed skill when installing again then it is unchanged", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom-project-management")
		_, err := installSkill(pmSkill, dir, false)
		require.NoError(t, err)

		state, err := installSkill(pmSkill, dir, false)

		require.NoError(t, err)
		assert.Equal(t, "unchanged", state)
	})

	t.Run("given an older SKILL.md when installing then it is updated and the script stays", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom-project-management")
		_, err := installSkill(pmSkill, dir, false)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: loom-project-management\n---\nold\n"), 0o644))

		state, err := installSkill(pmSkill, dir, false)

		require.NoError(t, err)
		assert.Equal(t, "updated", state)
		assert.Equal(t, pmSkillText, readFile(t, filepath.Join(dir, "SKILL.md")))
	})

	t.Run("given an older script when installing then it is updated and stays executable", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom-project-management")
		_, err := installSkill(pmSkill, dir, false)
		require.NoError(t, err)
		script := filepath.Join(dir, "scripts", "loom-pm.sh")
		require.NoError(t, os.WriteFile(script, []byte("#!/bin/sh\nold\n"), 0o644))

		state, err := installSkill(pmSkill, dir, false)

		require.NoError(t, err)
		assert.Equal(t, "updated", state)
		assert.Equal(t, pmScriptText, readFile(t, script))
		info, err := os.Stat(script)
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o755), info.Mode().Perm())
	})

	t.Run("given an identical script with the wrong mode when installing then the mode is fixed and counted as updated", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom-project-management")
		_, err := installSkill(pmSkill, dir, false)
		require.NoError(t, err)
		script := filepath.Join(dir, "scripts", "loom-pm.sh")
		require.NoError(t, os.Chmod(script, 0o644))

		state, err := installSkill(pmSkill, dir, false)

		require.NoError(t, err)
		assert.Equal(t, "updated", state)
		info, err := os.Stat(script)
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o755), info.Mode().Perm())
	})

	t.Run("given someone else's SKILL.md when installing then nothing is written unless forced", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom-project-management")
		path := filepath.Join(dir, "SKILL.md")
		other := "---\nname: other\n---\nmine\n"
		require.NoError(t, os.MkdirAll(dir, 0o755))
		require.NoError(t, os.WriteFile(path, []byte(other), 0o644))

		_, err := installSkill(pmSkill, dir, false)
		require.Error(t, err)
		assert.Equal(t, other, readFile(t, path))
		assert.NoFileExists(t, filepath.Join(dir, "scripts", "loom-pm.sh"))

		state, err := installSkill(pmSkill, dir, true)
		require.NoError(t, err)
		assert.Equal(t, "installed", state)
		assert.Equal(t, pmSkillText, readFile(t, path))
		assert.Equal(t, pmScriptText, readFile(t, filepath.Join(dir, "scripts", "loom-pm.sh")))
	})

	t.Run("given someone else's script and no SKILL.md when installing then it is refused unless forced", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom-project-management")
		script := filepath.Join(dir, "scripts", "loom-pm.sh")
		require.NoError(t, os.MkdirAll(filepath.Dir(script), 0o755))
		require.NoError(t, os.WriteFile(script, []byte("#!/bin/sh\nmine\n"), 0o755))

		_, err := installSkill(pmSkill, dir, false)
		require.Error(t, err)
		assert.Equal(t, "#!/bin/sh\nmine\n", readFile(t, script))
		assert.NoFileExists(t, filepath.Join(dir, "SKILL.md"))

		_, err = installSkill(pmSkill, dir, true)
		require.NoError(t, err)
		assert.Equal(t, pmScriptText, readFile(t, script))
	})
}

func TestUninstallSkill(t *testing.T) {
	t.Run("given the loom skill when uninstalling then it and its empty folder are removed", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom")
		_, err := installSkill(loomSkill, dir, false)
		require.NoError(t, err)

		state, err := uninstallSkill(loomSkill, dir)

		require.NoError(t, err)
		assert.Equal(t, "removed", state)
		assert.NoFileExists(t, filepath.Join(dir, "SKILL.md"))
		assert.NoDirExists(t, dir)
	})

	t.Run("given the project-management skill when uninstalling then files, scripts dir and skill dir are removed", func(t *testing.T) {
		root := t.TempDir()
		dir := filepath.Join(root, "loom-project-management")
		_, err := installSkill(pmSkill, dir, false)
		require.NoError(t, err)

		state, err := uninstallSkill(pmSkill, dir)

		require.NoError(t, err)
		assert.Equal(t, "removed", state)
		assert.NoFileExists(t, filepath.Join(dir, "scripts", "loom-pm.sh"))
		assert.NoDirExists(t, filepath.Join(dir, "scripts"))
		assert.NoDirExists(t, dir)
		assert.DirExists(t, root)
	})

	t.Run("given a user file in the skill folder when uninstalling then the folder is kept", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "loom-project-management")
		_, err := installSkill(pmSkill, dir, false)
		require.NoError(t, err)
		mine := filepath.Join(dir, "scripts", "mine.sh")
		require.NoError(t, os.WriteFile(mine, []byte("x"), 0o644))

		_, err = uninstallSkill(pmSkill, dir)

		require.NoError(t, err)
		assert.FileExists(t, mine)
		assert.NoFileExists(t, filepath.Join(dir, "SKILL.md"))
	})

	t.Run("given nothing installed when uninstalling then it is not an error", func(t *testing.T) {
		state, err := uninstallSkill(pmSkill, filepath.Join(t.TempDir(), "loom-project-management"))

		require.NoError(t, err)
		assert.Equal(t, "not installed", state)
	})

	t.Run("given a different skill at the same path when uninstalling then it is left alone", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "SKILL.md")
		require.NoError(t, os.WriteFile(path, []byte("---\nname: other\n---\n"), 0o644))

		_, err := uninstallSkill(pmSkill, dir)

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
		skills := filepath.Join(home, ".claude", "skills")
		var stdout, stderr bytes.Buffer

		code := runSkill([]string{"install"}, &stdout, &stderr)

		require.Equal(t, 0, code, stderr.String())
		assert.FileExists(t, filepath.Join(skills, "loom", "SKILL.md"))
		assert.FileExists(t, filepath.Join(skills, "loom-project-management", "SKILL.md"))
		assert.FileExists(t, filepath.Join(skills, "loom-project-management", "scripts", "loom-pm.sh"))
		assert.Contains(t, stdout.String(), "claude: installed "+filepath.Join(skills, "loom", "SKILL.md"))
		assert.Contains(t, stdout.String(), "claude: installed "+filepath.Join(skills, "loom-project-management", "SKILL.md"))
		assert.Contains(t, stdout.String(), "jq")

		stdout.Reset()
		code = runSkill([]string{"install"}, &stdout, &stderr)

		require.Equal(t, 0, code, stderr.String())
		assert.Equal(t, 2, strings.Count(stdout.String(), "claude: unchanged "))

		stdout.Reset()
		code = runSkill([]string{"uninstall"}, &stdout, &stderr)

		require.Equal(t, 0, code, stderr.String())
		assert.Equal(t, 2, strings.Count(stdout.String(), "claude: removed "))
		assert.NoDirExists(t, filepath.Join(skills, "loom"))
		assert.NoDirExists(t, filepath.Join(skills, "loom-project-management"))
	})

	t.Run("given --no-project-management when installing then only the loom skill is touched", func(t *testing.T) {
		dir := t.TempDir()
		var stdout, stderr bytes.Buffer

		code := runSkill([]string{"install", "--dir", dir, "--no-project-management"}, &stdout, &stderr)

		require.Equal(t, 0, code, stderr.String())
		assert.FileExists(t, filepath.Join(dir, "loom", "SKILL.md"))
		assert.NoDirExists(t, filepath.Join(dir, "loom-project-management"))
		assert.NotContains(t, stdout.String(), "loom-project-management")
		assert.NotContains(t, stdout.String(), "jq")
	})

	t.Run("given --no-project-management when uninstalling then the project-management skill stays", func(t *testing.T) {
		dir := t.TempDir()
		require.Equal(t, 0, runSkill([]string{"install", "--dir", dir}, &bytes.Buffer{}, &bytes.Buffer{}))
		var stderr bytes.Buffer

		code := runSkill([]string{"uninstall", "--dir", dir, "--no-project-management"}, &bytes.Buffer{}, &stderr)

		require.Equal(t, 0, code, stderr.String())
		assert.NoDirExists(t, filepath.Join(dir, "loom"))
		assert.FileExists(t, filepath.Join(dir, "loom-project-management", "SKILL.md"))
	})

	t.Run("given someone else's project-management SKILL.md when installing then exit 1 and it is kept", func(t *testing.T) {
		dir := t.TempDir()
		other := filepath.Join(dir, "loom-project-management", "SKILL.md")
		require.NoError(t, os.MkdirAll(filepath.Dir(other), 0o755))
		require.NoError(t, os.WriteFile(other, []byte("---\nname: other\n---\n"), 0o644))
		var stdout, stderr bytes.Buffer

		code := runSkill([]string{"install", "--dir", dir}, &stdout, &stderr)

		assert.Equal(t, 1, code)
		assert.Contains(t, stderr.String(), "not the loom-project-management skill")
		assert.Contains(t, stdout.String(), "dir: installed "+filepath.Join(dir, "loom", "SKILL.md"))
		assert.Equal(t, "---\nname: other\n---\n", readFile(t, other))
	})

	t.Run("print writes the skill", func(t *testing.T) {
		var stdout bytes.Buffer

		code := runSkill([]string{"print"}, &stdout, &bytes.Buffer{})

		assert.Equal(t, 0, code)
		assert.Equal(t, skillText, stdout.String())
	})

	t.Run("print project-management writes that skill", func(t *testing.T) {
		var stdout bytes.Buffer

		code := runSkill([]string{"print", "project-management"}, &stdout, &bytes.Buffer{})

		assert.Equal(t, 0, code)
		assert.Equal(t, pmSkillText, stdout.String())
	})

	t.Run("print of an unknown skill is a usage error", func(t *testing.T) {
		assert.Equal(t, 2, runSkill([]string{"print", "nope"}, &bytes.Buffer{}, &bytes.Buffer{}))
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
