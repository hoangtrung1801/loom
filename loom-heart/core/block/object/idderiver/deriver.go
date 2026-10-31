package idderiver

import (
	"context"

	"github.com/anyproto/any-sync/app"

	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
)

type Deriver interface {
	app.Component
	DeriveObjectId(ctx context.Context, spaceId string, key domain.UniqueKey) (id string, err error)
}
