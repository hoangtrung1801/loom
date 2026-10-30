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

	v2model "github.com/anyproto/anytype-heart/core/api/v2/model"
	"github.com/anyproto/anytype-heart/core/api/wrapper"
)

// OpenAPIPath is where the server serves the v2 document.
const OpenAPIPath = "/v2/docs/openapi.json"

// FetchInputs reads Derive's inputs from the server the client points at.
// The op members are all or nothing: Derive refuses a partial map, so when
// any op schema cannot be read the members are left nil and the edit tools'
// op lists stay bare (get_op_schema still serves every op).
func FetchInputs(ctx context.Context, client *wrapper.Client) (Inputs, error) {
	doc, err := get(ctx, client, OpenAPIPath)
	if err != nil {
		return Inputs{}, fmt.Errorf("read openapi document: %w", err)
	}
	members, err := fetchOpMembers(ctx, client)
	if err != nil {
		members = nil
	}
	return Inputs{OpenAPI: doc, OpMembers: members}, nil
}

// FetchTable derives the full table from the server the client points at.
func FetchTable(ctx context.Context, client *wrapper.Client) (*Table, error) {
	in, err := FetchInputs(ctx, client)
	if err != nil {
		return nil, err
	}
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
