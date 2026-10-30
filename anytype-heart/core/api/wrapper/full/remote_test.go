package full

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	v2model "github.com/anyproto/anytype-heart/core/api/v2/model"
	v2service "github.com/anyproto/anytype-heart/core/api/v2/service"
	"github.com/anyproto/anytype-heart/core/api/wrapper"
)

// discoveryServer serves the routes FetchInputs reads, from the same
// sources package api embeds, so a fetched table can be compared with the
// one the server derives. failOp makes that op's schema route answer 500.
func discoveryServer(t *testing.T, failOp string) *httptest.Server {
	t.Helper()
	doc, err := os.ReadFile(filepath.Join("..", "..", "docs", "v2", "openapi.json"))
	require.NoError(t, err)
	served, err := v2service.ServedOpSchemas()
	require.NoError(t, err)

	mux := http.NewServeMux()
	mux.HandleFunc("/v2/docs/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(doc)
	})
	mux.HandleFunc("/v2/schemas", func(w http.ResponseWriter, r *http.Request) {
		index := v2model.SchemaIndex{}
		for name := range served {
			index.Ops = append(index.Ops, v2model.SchemaIndexEntry{Kind: name, Url: "/v2/schemas/ops/" + name})
		}
		_ = json.NewEncoder(w).Encode(index)
	})
	mux.HandleFunc("/v2/schemas/ops/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/v2/schemas/ops/")
		if name == failOp {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"status":500,"code":"internal","message":"boom","issues":[]}`))
			return
		}
		_ = json.NewEncoder(w).Encode(v2model.SchemaEntry{Kind: name, Schema: served[name].Schema})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestFetchTable(t *testing.T) {
	t.Run("matches the table the server derives", func(t *testing.T) {
		// given
		srv := discoveryServer(t, "")
		want, err := deriveReal(t).ListJSON()
		require.NoError(t, err)

		// when
		table, err := FetchTable(context.Background(), wrapper.NewClient(srv.URL, "key"))

		// then
		require.NoError(t, err)
		got, err := table.ListJSON()
		require.NoError(t, err)
		assert.JSONEq(t, string(want), string(got))
	})

	t.Run("an unreadable op schema leaves the op lists bare", func(t *testing.T) {
		// given
		srv := discoveryServer(t, "set_properties")
		client := wrapper.NewClient(srv.URL, "key")
		client.Backoff = func(int) time.Duration { return 0 }

		// when
		in, err := FetchInputs(context.Background(), client)

		// then
		require.NoError(t, err)
		assert.Nil(t, in.OpMembers)
		_, err = Derive(in)
		require.NoError(t, err)
	})

	t.Run("no document is an error naming the route", func(t *testing.T) {
		// given
		srv := httptest.NewServer(http.NotFoundHandler())
		t.Cleanup(srv.Close)

		// when
		_, err := FetchTable(context.Background(), wrapper.NewClient(srv.URL, "key"))

		// then
		require.Error(t, err)
		assert.Contains(t, err.Error(), OpenAPIPath)
	})
}
