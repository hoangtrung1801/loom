package main

// skill.go — the skill verb: install the loom skill (SKILL.md, embedded in
// this binary) into a coding agent's skills directory, so the agent knows
// how to use the other verbs.
//
//	loom skill install [--agent claude,codex] [--project] [--dir DIR] [--force]
//	loom skill uninstall [same targets]
//	loom skill print                       the skill text on stdout
//
// The skill ships inside the binary, so what gets installed always matches
// the verbs of the loom that installs it; run install again after upgrading.

import (
	_ "embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

//go:embed SKILL.md
var skillText string

const (
	skillName = "loom"
	skillFile = "SKILL.md"

	skillUsage = `usage: loom skill install   [--agent claude,codex] [--project] [--dir DIR] [--force]
       loom skill uninstall [--agent claude,codex] [--project] [--dir DIR]
       loom skill print

  install writes the loom skill to <skills dir>/loom/SKILL.md for each agent:
    claude   ~/.claude/skills        (CLAUDE_CONFIG_DIR overrides ~/.claude)
    codex    ~/.codex/skills         (CODEX_HOME overrides ~/.codex)
  --project installs into the current directory instead (./.claude/skills, ./.codex/skills),
  so the skill can be committed with the project. --dir DIR installs into DIR/loom/SKILL.md
  for any other agent. Default agent: claude. --force replaces a file that is not the loom skill.`
)

// skillAgents maps an agent to its skills directory: the user-level one
// (given the lookup for environment variables and the home dir) and the
// project-level one.
var skillAgents = map[string]struct {
	user    func(getenv func(string) string, home string) string
	project string
}{
	"claude": {
		user: func(getenv func(string) string, home string) string {
			if d := getenv("CLAUDE_CONFIG_DIR"); d != "" {
				return filepath.Join(d, "skills")
			}
			return filepath.Join(home, ".claude", "skills")
		},
		project: filepath.Join(".claude", "skills"),
	},
	"codex": {
		user: func(getenv func(string) string, home string) string {
			if d := getenv("CODEX_HOME"); d != "" {
				return filepath.Join(d, "skills")
			}
			return filepath.Join(home, ".codex", "skills")
		},
		project: filepath.Join(".codex", "skills"),
	},
}

type skillOptions struct {
	agents  []string
	project bool
	dir     string
	force   bool
}

func parseSkillFlags(name string, argv []string, stderr io.Writer) (skillOptions, error) {
	var opt skillOptions
	var agents string
	fs := flag.NewFlagSet("skill "+name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() { fmt.Fprintln(stderr, skillUsage) }
	fs.StringVar(&agents, "agent", "", "comma-separated agents to install for (claude, codex); default claude")
	fs.BoolVar(&opt.project, "project", false, "use the current directory's skills folders instead of the user-level ones")
	fs.StringVar(&opt.dir, "dir", "", "install into DIR/loom/SKILL.md (for any other agent)")
	fs.BoolVar(&opt.force, "force", false, "replace an existing file that is not the loom skill")
	if err := fs.Parse(argv); err != nil {
		return opt, err
	}
	if fs.NArg() > 0 {
		return opt, fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	if opt.dir != "" && (agents != "" || opt.project) {
		return opt, errors.New("--dir cannot be combined with --agent or --project")
	}
	for _, a := range strings.Split(agents, ",") {
		if a = strings.ToLower(strings.TrimSpace(a)); a == "" {
			continue
		}
		if _, ok := skillAgents[a]; !ok {
			return opt, fmt.Errorf("unknown agent %q — known: claude, codex (or use --dir)", a)
		}
		opt.agents = append(opt.agents, a)
	}
	if len(opt.agents) == 0 && opt.dir == "" {
		opt.agents = []string{"claude"}
	}
	return opt, nil
}

// skillTargets resolves the skill file paths to act on, labelled by agent.
func skillTargets(opt skillOptions, getenv func(string) string, home, cwd string) ([]skillTarget, error) {
	if opt.dir != "" {
		dir, err := filepath.Abs(opt.dir)
		if err != nil {
			return nil, fmt.Errorf("resolve --dir: %w", err)
		}
		return []skillTarget{{label: "dir", path: filepath.Join(dir, skillName, skillFile)}}, nil
	}
	var out []skillTarget
	for _, a := range opt.agents {
		var root string
		if opt.project {
			root = filepath.Join(cwd, skillAgents[a].project)
		} else {
			if home == "" && getenv(map[string]string{"claude": "CLAUDE_CONFIG_DIR", "codex": "CODEX_HOME"}[a]) == "" {
				return nil, errors.New("cannot find the home directory — use --dir or --project")
			}
			root = skillAgents[a].user(getenv, home)
		}
		out = append(out, skillTarget{label: a, path: filepath.Join(root, skillName, skillFile)})
	}
	return out, nil
}

type skillTarget struct {
	label string
	path  string
}

// isLoomSkill tells the loom skill from some other file that happens to sit
// at the same path, by its front-matter name.
func isLoomSkill(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "name:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "name:")) == skillName
		}
	}
	return false
}

// installSkill writes the skill to path and says what happened:
// "installed", "updated" or "unchanged".
func installSkill(path string, force bool) (string, error) {
	state := "installed"
	existing, err := os.ReadFile(path)
	switch {
	case err == nil:
		if string(existing) == skillText {
			return "unchanged", nil
		}
		if !isLoomSkill(string(existing)) && !force {
			return "", fmt.Errorf("%s exists and is not the loom skill — use --force to replace it", path)
		}
		state = "updated"
	case !errors.Is(err, os.ErrNotExist):
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	if err = os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("create skill dir: %w", err)
	}
	if err = os.WriteFile(path, []byte(skillText), 0o644); err != nil {
		return "", fmt.Errorf("write %s: %w", path, err)
	}
	return state, nil
}

// uninstallSkill removes the skill file and its folder when that leaves it
// empty. Only the loom skill is removed.
func uninstallSkill(path string) (string, error) {
	existing, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "not installed", nil
		}
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	if !isLoomSkill(string(existing)) {
		return "", fmt.Errorf("%s is not the loom skill — left alone", path)
	}
	if err = os.Remove(path); err != nil {
		return "", fmt.Errorf("remove %s: %w", path, err)
	}
	_ = os.Remove(filepath.Dir(path)) // only succeeds when empty
	return "removed", nil
}

func runSkill(argv []string, stdout, stderr io.Writer) int {
	if len(argv) == 0 || argv[0] == "help" || argv[0] == "--help" || argv[0] == "-h" {
		fmt.Fprintln(stdout, skillUsage)
		if len(argv) == 0 {
			return 2
		}
		return 0
	}
	sub := argv[0]
	if sub == "print" {
		fmt.Fprint(stdout, skillText)
		return 0
	}
	if sub != "install" && sub != "uninstall" {
		fmt.Fprintf(stderr, "error: unknown skill command %q\n%s\n", sub, skillUsage)
		return 2
	}

	opt, err := parseSkillFlags(sub, argv[1:], stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		fmt.Fprintln(stderr, "error:", err)
		return 2
	}
	home, _ := os.UserHomeDir()
	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(stderr, "error: current directory:", err)
		return 1
	}
	targets, err := skillTargets(opt, os.Getenv, home, cwd)
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 2
	}

	code := 0
	for _, t := range targets {
		var state string
		if sub == "install" {
			state, err = installSkill(t.path, opt.force)
		} else {
			state, err = uninstallSkill(t.path)
		}
		if err != nil {
			fmt.Fprintf(stderr, "%s: error: %v\n", t.label, err)
			code = 1
			continue
		}
		fmt.Fprintf(stdout, "%s: %s %s\n", t.label, state, t.path)
	}
	if sub == "install" && code == 0 {
		fmt.Fprintln(stdout, "restart the agent (or start a new session) to load it; the skill needs `loom` on your PATH")
	}
	return code
}
