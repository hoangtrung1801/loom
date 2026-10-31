package config_test

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/loom/config"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/gateway"
)

// The gateway resolves its AddrStore by interface, so renaming either method on Config would
// compile everywhere and panic on every app start instead. Pinned from an external test package:
// the gateway reaches config transitively, so an in-package test here would be an import cycle.
var _ gateway.AddrStore = (*config.Config)(nil)
