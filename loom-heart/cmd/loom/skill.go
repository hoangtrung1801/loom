package main

// skill.go — the skill verb: install the loom skills (embedded in this
// binary) into a coding agent's skills directory, so the agent knows how to
// use the other verbs. Two skills ship: `loom` (SKILL.md) and
// `loom-project-management` (SKILL.md plus scripts/loom-pm.sh, a helper that
// needs jq).
//
//	loom skill install [--agent claude,codex] [--project] [--dir DIR] [--force] [--no-project-management]
//	loom skill uninstall [same targets]
//	loom skill print [project-management]   the skill text on stdout
//
// --no-project-management limits install and uninstall to the loom skill.
//
// The skills ship inside the binary, so what gets installed always matches
// the verbs of the loom that installs it; run install again after upgrading.

import (
	_ "embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed SKILL.md
var skillText string

// The project-management skill keeps its on-disk layout under skills/ here
// (a //go:embed cannot reach outside the package directory). The repo-level
// copy in .claude/skills/loom-project-management must stay identical; a test
// guards against drift.
//
//go:embed skills/loom-project-management/SKILL.md
var pmSkillText string

//go:embed skills/loom-project-management/scripts/loom-pm.sh
var pmScriptText string

const (
	skillName   = "loom"
	pmSkillName = "loom-project-management"
	skillFile   = "SKILL.md"

	skillUsage = `usage: loom skill install   [--agent claude,codex] [--project] [--dir DIR] [--force] [--no-project-management]
       loom skill uninstall [--agent claude,codex] [--project] [--dir DIR] [--no-project-management]
       loom skill print [project-management]

  install writes two skills for each agent:
    <skills dir>/loom/SKILL.md                                 how to use the loom verbs
    <skills dir>/loom-project-management/SKILL.md              project and task management in Loom
    <skills dir>/loom-project-management/scripts/loom-pm.sh   its helper script (needs jq on PATH)
  agents and their skills dirs:
    claude   ~/.claude/skills        (CLAUDE_CONFIG_DIR overrides ~/.claude)
    codex    ~/.codex/skills         (CODEX_HOME overrides ~/.codex)
  --project installs into the current directory instead (./.claude/skills, ./.codex/skills),
  so the skills can be committed with the project. --dir DIR installs into DIR/loom/ and
  DIR/loom-project-management/ for any other agent. Default agent: claude.
  --force replaces a file that is not ours. --no-project-management touches only the loom skill.
  uninstall removes the files install wrote, and the folders if that leaves them empty.`
)

// skillFileSpec is one file of a skill, relative to the skill folder.
type skillFileSpec struct {
	rel     string // slash-separated
	content string
	mode    os.FileMode
}

// skillBundle is a skill: its name (the front-matter name: of its SKILL.md)
// and its files. files[0] is always SKILL.md; it decides whether the folder is ours.
type skillBundle struct {
	name  string
	files []skillFileSpec
}

var loomSkill = skillBundle{
	name:  skillName,
	files: []skillFileSpec{{rel: skillFile, content: skillText, mode: 0o644}},
}

var pmSkill = skillBundle{
	name: pmSkillName,
	files: []skillFileSpec{
		{rel: skillFile, content: pmSkillText, mode: 0o644},
		{rel: "scripts/loom-pm.sh", content: pmScriptText, mode: 0o755},
	},
}

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

	noProjectManagement bool
}

func parseSkillFlags(name string, argv []string, stderr io.Writer) (skillOptions, error) {
	var opt skillOptions
	var agents string
	fs := flag.NewFlagSet("skill "+name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() { fmt.Fprintln(stderr, skillUsage) }
	fs.StringVar(&agents, "agent", "", "comma-separated agents to install for (claude, codex); default claude")
	fs.BoolVar(&opt.project, "project", false, "use the current directory's skills folders instead of the user-level ones")
	fs.StringVar(&opt.dir, "dir", "", "install into DIR/loom/ and DIR/loom-project-management/ (for any other agent)")
	fs.BoolVar(&opt.force, "force", false, "replace an existing file that is not ours")
	fs.BoolVar(&opt.noProjectManagement, "no-project-management", false, "only the loom skill, not loom-project-management")
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

// skillRoot is the skills directory a target's loom/SKILL.md sits in.
func (t skillTarget) skillRoot() string {
	return filepath.Dir(filepath.Dir(t.path))
}

// isSkillNamed tells the skill called name from some other file that happens
// to sit at the same path, by its front-matter name.
func isSkillNamed(content, name string) bool {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "name:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "name:")) == name
		}
	}
	return false
}

// skillFilePlan is what install will do to one file of a skill.
type skillFilePlan struct {
	path  string
	spec  skillFileSpec
	state string // "installed", "updated", "mode" (chmod only) or "unchanged"
}

// installSkill writes the skill into dir (its folder, <skills dir>/<name>) and
// says what happened: "installed" if any file was new, else "updated" if any
// changed, else "unchanged". Nothing is written when a file is refused.
func installSkill(b skillBundle, dir string, force bool) (string, error) {
	// the folder is ours when its SKILL.md carries our name; the other files
	// are only replaced then (or with force)
	owned := false
	existing, err := os.ReadFile(filepath.Join(dir, skillFile))
	switch {
	case err == nil:
		owned = isSkillNamed(string(existing), b.name)
	case !errors.Is(err, os.ErrNotExist):
		return "", fmt.Errorf("read %s: %w", filepath.Join(dir, skillFile), err)
	}

	plans := make([]skillFilePlan, 0, len(b.files))
	for i, f := range b.files {
		plan := skillFilePlan{path: filepath.Join(dir, filepath.FromSlash(f.rel)), spec: f, state: "installed"}
		current, err := os.ReadFile(plan.path)
		switch {
		case err == nil:
			if string(current) != f.content {
				if !owned && !force {
					if i == 0 {
						return "", fmt.Errorf("%s exists and is not the %s skill — use --force to replace it", plan.path, b.name)
					}
					return "", fmt.Errorf("%s exists and is not part of the %s skill — use --force to replace it", plan.path, b.name)
				}
				plan.state = "updated"
			} else {
				plan.state = "unchanged"
				if info, err := os.Stat(plan.path); err == nil && f.mode&0o111 != 0 && info.Mode().Perm() != f.mode {
					plan.state = "mode"
				}
			}
		case !errors.Is(err, os.ErrNotExist):
			return "", fmt.Errorf("read %s: %w", plan.path, err)
		}
		plans = append(plans, plan)
	}

	result := "unchanged"
	for _, plan := range plans {
		switch plan.state {
		case "installed", "updated":
			if err = os.MkdirAll(filepath.Dir(plan.path), 0o755); err != nil {
				return "", fmt.Errorf("create skill dir: %w", err)
			}
			if err = os.WriteFile(plan.path, []byte(plan.spec.content), plan.spec.mode); err != nil {
				return "", fmt.Errorf("write %s: %w", plan.path, err)
			}
			// WriteFile applies the umask and keeps the mode of an existing file
			if plan.spec.mode&0o111 != 0 {
				if err = os.Chmod(plan.path, plan.spec.mode); err != nil {
					return "", fmt.Errorf("chmod %s: %w", plan.path, err)
				}
			}
		case "mode":
			if err = os.Chmod(plan.path, plan.spec.mode); err != nil {
				return "", fmt.Errorf("chmod %s: %w", plan.path, err)
			}
			plan.state = "updated"
		}
		switch {
		case plan.state == "installed":
			result = "installed"
		case plan.state == "updated" && result != "installed":
			result = "updated"
		}
	}
	return result, nil
}

// uninstallSkill removes the skill's files from dir, then its folders when
// that leaves them empty. Only a skill that is ours is removed.
func uninstallSkill(b skillBundle, dir string) (string, error) {
	skillPath := filepath.Join(dir, skillFile)
	existing, err := os.ReadFile(skillPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "not installed", nil
		}
		return "", fmt.Errorf("read %s: %w", skillPath, err)
	}
	if !isSkillNamed(string(existing), b.name) {
		return "", fmt.Errorf("%s is not the %s skill — left alone", skillPath, b.name)
	}

	var dirs []string
	for i := len(b.files) - 1; i >= 0; i-- {
		rel := filepath.FromSlash(b.files[i].rel)
		path := filepath.Join(dir, rel)
		if err = os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("remove %s: %w", path, err)
		}
		for d := filepath.Dir(rel); d != "."; d = filepath.Dir(d) {
			dirs = append(dirs, filepath.Join(dir, d))
		}
	}
	sort.Slice(dirs, func(i, j int) bool { return len(dirs[i]) > len(dirs[j]) })
	for _, d := range append(dirs, dir) {
		_ = os.Remove(d) // only succeeds when empty
	}
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
		if len(argv) > 2 {
			fmt.Fprintf(stderr, "error: unexpected argument %q\n", argv[2])
			return 2
		}
		text := skillText
		if len(argv) == 2 {
			if (argv[1] != "project-management") && (argv[1] != pmSkillName) {
				fmt.Fprintf(stderr, "error: unknown skill %q — known: project-management\n", argv[1])
				return 2
			}
			text = pmSkillText
		}
		fmt.Fprint(stdout, text)
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

	skills := []skillBundle{loomSkill}
	if !opt.noProjectManagement {
		skills = append(skills, pmSkill)
	}

	code := 0
	for _, t := range targets {
		for _, b := range skills {
			dir := filepath.Join(t.skillRoot(), b.name)
			var state string
			if sub == "install" {
				state, err = installSkill(b, dir, opt.force)
			} else {
				state, err = uninstallSkill(b, dir)
			}
			if err != nil {
				fmt.Fprintf(stderr, "%s: error: %v\n", t.label, err)
				code = 1
				continue
			}
			fmt.Fprintf(stdout, "%s: %s %s\n", t.label, state, filepath.Join(dir, skillFile))
		}
	}
	if sub == "install" && code == 0 {
		msg := "restart the agent (or start a new session) to load it; the skill needs `loom` on your PATH"
		if !opt.noProjectManagement {
			msg += "; the loom-project-management skill also needs `jq` on your PATH"
		}
		fmt.Fprintln(stdout, msg)
	}
	return code
}
