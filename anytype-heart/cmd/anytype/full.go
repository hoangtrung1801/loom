package main

// full.go — the CLI's delivery of the full tool table (one tool per /v2
// operation, package full): `mcp --tier full`, `tools --tier full` and the
// `api` verb. The table is derived from the running server's own OpenAPI
// document, so these reach every kind of object that server serves.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/anyproto/anytype-heart/core/api/wrapper"
	"github.com/anyproto/anytype-heart/core/api/wrapper/full"
)

func newClient() *wrapper.Client {
	return wrapper.NewClient(os.Getenv("ANYTYPE_API_URL"), os.Getenv("ANYTYPE_API_KEY"))
}

// fullExecutor derives the full table from the server and runs tools over
// the same client.
func fullExecutor(ctx context.Context) (*full.Executor, *full.Table, error) {
	client := newClient()
	table, err := full.FetchTable(ctx, client)
	if err != nil {
		return nil, nil, fmt.Errorf("the full tool table is read from the running app's API at %s (is Anytype running with the API on, and ANYTYPE_API_KEY set?): %w", client.BaseURL, err)
	}
	return full.NewExecutor(client, table), table, nil
}

// manifestJSON is the tools verb's output for any tier.
func manifestJSON(tier wrapper.Tier) ([]byte, error) {
	if tier != wrapper.TierFull {
		return wrapper.ManifestJSONForTier(tier)
	}
	_, table, err := fullExecutor(context.Background())
	if err != nil {
		return nil, err
	}
	return table.ListJSON()
}

// mcpServer builds the stdio MCP loop for a tier. The curated tiers keep
// handle state in memory for the process lifetime, not in the CLI session
// file — concurrent MCP servers must not fight over one file, and a host
// restart starting from a clean session is the predictable behavior. The
// full table has no handles.
func mcpServer(tier wrapper.Tier) (*wrapper.MCPServer, error) {
	if tier != wrapper.TierFull {
		return wrapper.NewMCPServer(wrapper.NewRunner(newClient(), wrapper.NewMemoryStore()), tier), nil
	}
	exec, _, err := fullExecutor(context.Background())
	if err != nil {
		return nil, err
	}
	return wrapper.NewMCPServerOver(exec, tier, newClient().BaseURL), nil
}

const apiUsage = `usage: anytype api                              list every operation
       anytype api <operation> --help           its arguments (JSON Schema)
       anytype api <operation> [key=value …]    run it; values are JSON when they parse
       anytype api <operation> '{"key": …}'     run it with a JSON object ("-" reads stdin)`

// runAPI is the api verb: the full table on the command line.
func runAPI(argv []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(argv) > 0 && (argv[0] == "--help" || argv[0] == "-h" || argv[0] == "help") {
		fmt.Fprintln(stdout, apiUsage)
		return 0
	}
	ctx := context.Background()
	exec, table, err := fullExecutor(ctx)
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	if len(argv) == 0 {
		for _, t := range exec.Tools() {
			fmt.Fprintf(stdout, "%-32s %s%s\n", t.Name, firstSentence(t.Description), toolMarker(t))
		}
		fmt.Fprintln(stdout, "\n"+apiUsage)
		return 0
	}

	name := argv[0]
	tool, ok := toolListing(exec, name)
	if !ok {
		fmt.Fprintf(stderr, "error: unknown operation %q — run \"anytype api\" for the list (%d operations)\n", name, len(table.Names()))
		return 2
	}
	rest := argv[1:]
	if len(rest) == 1 && (rest[0] == "--help" || rest[0] == "-h") {
		schema, err := json.MarshalIndent(tool.InputSchema, "", "  ")
		if err != nil {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}
		fmt.Fprintf(stdout, "%s%s\n\n%s\n\narguments:\n%s\n", tool.Name, toolMarker(tool), tool.Description, schema)
		return 0
	}
	args, err := parseAPIArgs(rest, stdin)
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 2
	}

	result, err := exec.Run(ctx, name, args)
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		var argErr wrapper.ArgumentError
		if errors.As(err, &argErr) {
			return 2
		}
		return 1
	}
	fmt.Fprintln(stdout, result.Text)
	return 0
}

func toolListing(exec *full.Executor, name string) (wrapper.ToolListing, bool) {
	for _, t := range exec.Tools() {
		if t.Name == name {
			return t, true
		}
	}
	return wrapper.ToolListing{}, false
}

func toolMarker(t wrapper.ToolListing) string {
	switch {
	case t.Destructive:
		return " [destructive]"
	case t.ReadOnly:
		return " [read-only]"
	}
	return ""
}

// parseAPIArgs reads an operation's arguments: one JSON object (inline, or
// "-" for stdin), or key=value pairs whose values are JSON when they parse
// (numbers, booleans, lists, objects) and plain strings otherwise.
func parseAPIArgs(argv []string, stdin io.Reader) (map[string]any, error) {
	args := map[string]any{}
	if len(argv) == 1 && (argv[0] == "-" || strings.HasPrefix(strings.TrimSpace(argv[0]), "{")) {
		raw := []byte(argv[0])
		if argv[0] == "-" {
			var err error
			if raw, err = io.ReadAll(stdin); err != nil {
				return nil, fmt.Errorf("read arguments from stdin: %w", err)
			}
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, fmt.Errorf(`arguments must be a JSON object, e.g. '{"space_id":"bafy…"}': %w`, err)
		}
		return args, nil
	}
	for _, pair := range argv {
		key, value, ok := strings.Cut(pair, "=")
		if !ok || key == "" {
			return nil, fmt.Errorf("unexpected argument %q — pass key=value pairs or one JSON object", pair)
		}
		var decoded any
		if err := json.Unmarshal([]byte(value), &decoded); err == nil {
			args[key] = decoded
		} else {
			args[key] = value
		}
	}
	return args, nil
}
