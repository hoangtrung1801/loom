package full

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	v2model "github.com/hoangtrung1801/loom/loom-heart/core/api/v2/model"
	v2service "github.com/hoangtrung1801/loom/loom-heart/core/api/v2/service"
	"github.com/hoangtrung1801/loom/loom-heart/core/api/wrapper"
)

// discoveryServer serves the routes FetchInputs reads, from the same
// sources package api embeds, so a fetched table can be compared with the
// one the server derives. failOp makes that op's schema route answer 500.
func discoveryServer(t *testing.T, failOp string) *httptest.Server {
	t.Helper()
	srv, _ := countingDiscoveryServer(t, failOp)
	return srv
}

// countingDiscoveryServer also counts the requests it answers, by path.
func countingDiscoveryServer(t *testing.T, failOp string) (*httptest.Server, func() []string) {
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
	var mu sync.Mutex
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.URL.Path)
		mu.Unlock()
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
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

func TestFetchBareTable(t *testing.T) {
	t.Run("one request, and the same tools as the full fetch", func(t *testing.T) {
		// given
		srv, requests := countingDiscoveryServer(t, "")
		client := wrapper.NewClient(srv.URL, "key")

		// when
		bare, err := FetchBareTable(context.Background(), client)

		// then
		require.NoError(t, err)
		assert.Equal(t, []string{OpenAPIPath}, requests())
		fetched, err := FetchTable(context.Background(), client)
		require.NoError(t, err)
		assert.Equal(t, fetched.Names(), bare.Names())
	})

	t.Run("the full fetch also reads the schema index and every op schema", func(t *testing.T) {
		// given
		srv, requests := countingDiscoveryServer(t, "")

		// when
		_, err := FetchTable(context.Background(), wrapper.NewClient(srv.URL, "key"))

		// then
		require.NoError(t, err)
		got := requests()
		assert.Contains(t, got, "/v2/schemas")
		assert.Greater(t, len(got), 2, "one request per op schema")
	})
}

func TestRouteTemplates(t *testing.T) {
	assert.NotEmpty(t, RouteTemplates())
	for _, rt := range RouteTemplates() {
		assert.True(t, strings.HasPrefix(rt.Path, "/v2/"), rt.Path)
	}
}
