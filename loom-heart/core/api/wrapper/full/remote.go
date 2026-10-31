package full

// remote.go — the full table for a process that is not the API server: the
// anytype CLI's `mcp --tier full` and `api` verbs. Derive's inputs are read
// from the running server — the v2 OpenAPI document it serves and the op
// schemas its discovery routes answer — so the table is the one that
// server's own /mcp/full route derives, for whatever version is running,
// without linking the service layer into the CLI.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	v2model "github.com/hoangtrung1801/loom/loom-heart/core/api/v2/model"
	"github.com/hoangtrung1801/loom/loom-heart/core/api/wrapper"
)

// OpenAPIPath is where the server serves the v2 document.
const OpenAPIPath = "/v2/docs/openapi.json"

// FetchOpenAPIInputs reads only the OpenAPI document: one request. The op
// lists in the edit tools' descriptions stay bare, which a single call
// (running or describing one operation) never needs.
func FetchOpenAPIInputs(ctx context.Context, client *wrapper.Client) (Inputs, error) {
	doc, err := get(ctx, client, OpenAPIPath)
	if err != nil {
		return Inputs{}, fmt.Errorf("read openapi document: %w", err)
	}
	return Inputs{OpenAPI: doc}, nil
}

// FetchInputs reads Derive's inputs from the server the client points at:
// the document plus every op schema (one request each). The op members are
// all or nothing: Derive refuses a partial map, so when any op schema cannot
// be read the members are left nil and the edit tools' op lists stay bare
// (get_op_schema still serves every op).
func FetchInputs(ctx context.Context, client *wrapper.Client) (Inputs, error) {
	in, err := FetchOpenAPIInputs(ctx, client)
	if err != nil {
		return Inputs{}, err
	}
	members, err := fetchOpMembers(ctx, client)
	if err != nil {
		members = nil
	}
	in.OpMembers = members
	return in, nil
}

// FetchTable derives the full table, op lists included, from the server the
// client points at.
func FetchTable(ctx context.Context, client *wrapper.Client) (*Table, error) {
	in, err := FetchInputs(ctx, client)
	if err != nil {
		return nil, err
	}
	return deriveFetched(in)
}

// FetchBareTable derives the table from the OpenAPI document alone — one
// request. Every tool and its arguments are the same as FetchTable's; only
// the op lists in the edit tools' descriptions are bare.
func FetchBareTable(ctx context.Context, client *wrapper.Client) (*Table, error) {
	in, err := FetchOpenAPIInputs(ctx, client)
	if err != nil {
		return nil, err
	}
	return deriveFetched(in)
}

func deriveFetched(in Inputs) (*Table, error) {
	table, err := Derive(in)
	if err != nil {
		return nil, fmt.Errorf("derive full tool table: %w", err)
	}
	return table, nil
}

func fetchOpMembers(ctx context.Context, client *wrapper.Client) (map[string][]string, error) {
	body, err := get(ctx, client, "/v2/schemas")
	if err != nil {
		return nil, fmt.Errorf("read schema index: %w", err)
	}
	var index v2model.SchemaIndex
	if err := json.Unmarshal(body, &index); err != nil {
		return nil, fmt.Errorf("decode schema index: %w", err)
	}
	members := make(map[string][]string, len(index.Ops))
	for _, op := range index.Ops {
		body, err := get(ctx, client, "/v2/schemas/ops/"+url.PathEscape(op.Kind))
		if err != nil {
			return nil, fmt.Errorf("read op schema %q: %w", op.Kind, err)
		}
		var entry v2model.SchemaEntry
		if err := json.Unmarshal(body, &entry); err != nil {
			return nil, fmt.Errorf("decode op schema %q: %w", op.Kind, err)
		}
		m, err := OpMembers(entry.Schema)
		if err != nil {
			return nil, fmt.Errorf("op %q: %w", op.Kind, err)
		}
		members[op.Kind] = m
	}
	return members, nil
}

// get reads one discovery route; anything but a 2xx is an error carrying
// the server's own message.
func get(ctx context.Context, client *wrapper.Client, path string) ([]byte, error) {
	status, body, err := client.DoRaw(ctx, wrapper.RawRequest{Method: http.MethodGet, Path: path})
	if err != nil {
		return nil, fmt.Errorf("get %s: %w", path, err)
	}
	if status < 200 || status > 299 {
		return nil, fmt.Errorf("get %s: %w", path, refusal(status, body))
	}
	return body, nil
}

// RouteTemplates lists the discovery routes this file reads, for the
// server-side guard that they stay registered.
func RouteTemplates() []wrapper.RouteTemplate {
	return []wrapper.RouteTemplate{
		{Method: http.MethodGet, Path: OpenAPIPath},
		{Method: http.MethodGet, Path: "/v2/schemas"},
		{Method: http.MethodGet, Path: "/v2/schemas/ops/:op"},
	}
}
