package testutil

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/state"
	"github.com/hoangtrung1801/loom/loom-heart/pb"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
	"github.com/hoangtrung1801/loom/loom-heart/tests/blockbuilder"
)

func BuildStateFromAST(root *blockbuilder.Block) *state.State {
	st, err := state.NewDocFromSnapshot("", &pb.ChangeSnapshot{
		Data: &model.SmartBlockSnapshotBase{
			Blocks: root.Build(),
		},
	})
	if err != nil {
		panic(err)
	}
	_, _, err = state.ApplyState("", st, true)
	if err != nil {
		panic(err)
	}
	return st.NewState()
}
