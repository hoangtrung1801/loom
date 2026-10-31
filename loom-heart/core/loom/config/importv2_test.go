package config

import (
	"testing"

	"github.com/kelseyhightower/envconfig"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Markdown, Obsidian and Notion imports run on the v2 engine by default. The
// env vars are the kill switch, so an explicit "false" has to win over the
// default — that is the property worth pinning, not the default itself.
func TestImportV2DefaultsAndKillSwitch(t *testing.T) {
	t.Run("new config routes markdown and notion to v2", func(t *testing.T) {
		// when
		cfg := New()

		// then
		assert.True(t, cfg.ImportV2Markdown)
		assert.True(t, cfg.ImportV2Notion)
	})

	t.Run("an explicit false in the env routes back to v1", func(t *testing.T) {
		// given
		cfg := New()
		require.True(t, cfg.ImportV2Markdown)
		require.True(t, cfg.ImportV2Notion)
		t.Setenv("LOOM_IMPORTV2MARKDOWN", "false")
		t.Setenv("LOOM_IMPORTV2NOTION", "false")

		// when — the same call initFromFileAndEnv makes
		err := envconfig.Process("LOOM", cfg)

		// then
		require.NoError(t, err)
		assert.False(t, cfg.ImportV2Markdown, "kill switch must override the default")
		assert.False(t, cfg.ImportV2Notion, "kill switch must override the default")
	})

	t.Run("an absent env var leaves the default alone", func(t *testing.T) {
		// given
		cfg := New()

		// when
		require.NoError(t, envconfig.Process("LOOM", cfg))

		// then
		assert.True(t, cfg.ImportV2Markdown)
		assert.True(t, cfg.ImportV2Notion)
	})
}
