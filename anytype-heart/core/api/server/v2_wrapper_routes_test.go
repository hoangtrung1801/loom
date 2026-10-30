package server

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/anyproto/anytype-heart/core/api/wrapper"
	"github.com/anyproto/anytype-heart/core/api/wrapper/full"
)

// TestWrapperRoutesRegistered walks the task-tool wrapper's hard-coded
// route templates against the gin router's registered routes: the wrapper
// suite stubs its own paths, so a renamed /v2 route would otherwise stay
// green there while every tool 404s in production.
func TestWrapperRoutesRegistered(t *testing.T) {
	fx := newV2ServerFixture(t)
	engine := fx.NewRouter(fx.mwMock, fx.eventMock, []byte{}, []byte{})

	registered := map[string]bool{}
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}

	for _, rt := range wrapper.RouteTemplates() {
		assert.True(t, registered[rt.Method+" "+rt.Path],
			fmt.Sprintf("the wrapper calls %s %s but the router does not register it", rt.Method, rt.Path))
	}
}

// TestCLIRoutesRegistered guards the anytype CLI's own dependencies: the
// full tool table is derived from the discovery routes, and `anytype auth`
// pairs through the auth routes. A rename would leave the CLI suites green
// (they stub the server) and break both against a real app.
func TestCLIRoutesRegistered(t *testing.T) {
	fx := newV2ServerFixture(t)
	engine := fx.NewRouter(fx.mwMock, fx.eventMock, []byte{}, []byte{})

	registered := map[string]bool{}
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}

	// the auth routes are called by cmd/anytype (package main, so not
	// importable); keep this list in step with auth.go
	routes := append(full.RouteTemplates(),
		wrapper.RouteTemplate{Method: "POST", Path: "/v2/auth/challenges"},
		wrapper.RouteTemplate{Method: "POST", Path: "/v2/auth/api_keys"},
		wrapper.RouteTemplate{Method: "GET", Path: "/v2/auth/whoami"},
	)
	for _, rt := range routes {
		assert.True(t, registered[rt.Method+" "+rt.Path],
			fmt.Sprintf("the anytype CLI calls %s %s but the router does not register it", rt.Method, rt.Path))
	}
}
