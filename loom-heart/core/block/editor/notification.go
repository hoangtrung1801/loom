package editor

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/smartblock"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/state"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/template"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/migration"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
)

type NotificationObject struct {
	smartblock.SmartBlock
}

// required relations for notifications beside the bundle.RequiredInternalRelations
var notificationsRequiredRelations = []domain.RelationKey{}

func NewNotificationObject(sb smartblock.SmartBlock) *NotificationObject {
	return &NotificationObject{
		SmartBlock: sb,
	}
}

func (n *NotificationObject) CreationStateMigration(ctx *smartblock.InitContext) migration.Migration {
	return migration.Migration{
		Version: 1,
		Proc: func(st *state.State) {
			template.InitTemplate(st,
				template.WithEmpty,
				template.WithNoObjectTypes(),
			)
		},
	}
}

func (n *NotificationObject) Init(ctx *smartblock.InitContext) (err error) {
	ctx.RequiredInternalRelationKeys = notificationsRequiredRelations
	if err = n.SmartBlock.Init(ctx); err != nil {
		return
	}
	return nil
}
