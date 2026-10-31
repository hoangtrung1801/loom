package history

import (
	"fmt"

	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/smartblock"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/state"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/migration"
)

func ResetToVersion(sb smartblock.SmartBlock, st *state.State) error {
	if err := sb.ResetToVersion(st); err != nil {
		return fmt.Errorf("resetting smartblock to version: %w", err)
	}
	migration.RunMigrations(sb, &smartblock.InitContext{
		State:   sb.NewState(),
		SpaceID: sb.SpaceID(),
	})
	return nil
}
