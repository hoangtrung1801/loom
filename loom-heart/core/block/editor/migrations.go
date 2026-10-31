package editor

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/smartblock"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/state"
	"github.com/hoangtrung1801/loom/loom-heart/core/files/fileobject"
)

func migrateFilesToObjects(sb smartblock.SmartBlock, fileObjectService fileobject.Service) func(s *state.State) {
	return func(st *state.State) {
		fileObjectService.MigrateFileIdsInBlocks(st, sb.Space())
	}
}
