package syncer

import (
	"context"

	"github.com/hoangtrung1801/loom/loom-heart/core/block"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/smartblock"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/simple"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain/objectorigin"
	"github.com/hoangtrung1801/loom/loom-heart/core/session"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
)

type BlockService interface {
	GetObject(ctx context.Context, objectID string) (sb smartblock.SmartBlock, err error)
	GetObjectByFullID(ctx context.Context, id domain.FullID) (sb smartblock.SmartBlock, err error)
	UploadFile(ctx context.Context, spaceId string, req block.FileUploadRequest) (objectId string, fileType model.BlockContentFileType, details *domain.Details, err error)
	UploadBlockFile(ctx session.Context, req block.UploadRequest, groupID string, isSync bool) (fileObjectId string, err error)
}

type Syncer interface {
	Sync(id domain.FullID, newIdsSet map[string]struct{}, b simple.Block, origin objectorigin.ObjectOrigin) error
}
