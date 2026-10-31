package editor

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/basic"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/order"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/smartblock"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/state"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/template"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/migration"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/bundle"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
)

var relationOptionRequiredRelations = []domain.RelationKey{
	bundle.RelationKeyApiObjectKey,
}

type RelationOption struct {
	smartblock.SmartBlock
	basic.AllOperations
	basic.IHistory
	order.OrderSettable
}

func (f *ObjectFactory) newRelationOption(spaceId string, sb smartblock.SmartBlock) *RelationOption {
	store := f.objectStore.SpaceIndex(spaceId)
	return &RelationOption{
		SmartBlock:     sb,
		AllOperations:  basic.NewBasic(sb, store, f.layoutConverter, f.fileObjectService),
		IHistory:       basic.NewHistory(sb),
		OrderSettable:  order.NewOrderSettable(sb, bundle.RelationKeyOrderId),
	}
}

func (ro *RelationOption) Init(ctx *smartblock.InitContext) (err error) {
	ctx.RequiredInternalRelationKeys = append(ctx.RequiredInternalRelationKeys, relationOptionRequiredRelations...)

	if err = ro.SmartBlock.Init(ctx); err != nil {
		return
	}
	return nil
}

func (ro *RelationOption) CreationStateMigration(ctx *smartblock.InitContext) migration.Migration {
	return migration.Migration{
		Version: 1,
		Proc: func(s *state.State) {
			template.InitTemplate(s,
				template.WithEmpty,
				template.WithObjectTypes([]domain.TypeKey{bundle.TypeKeyRelationOption}),
				template.WithTitle,
				template.WithLayout(model.ObjectType_relationOption),
			)
		},
	}
}

func (ro *RelationOption) StateMigrations() migration.Migrations {
	return migration.MakeMigrations([]migration.Migration{
		{
			Version: 1,
			Proc:    func(s *state.State) {},
		},
	})
}
