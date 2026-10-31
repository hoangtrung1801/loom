package importer

import (
	"context"

	"github.com/anyproto/any-sync/app"

	"github.com/hoangtrung1801/loom/loom-heart/core/block"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/import/common"
	creator "github.com/hoangtrung1801/loom/loom-heart/core/block/import/common/objectcreator"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/import/common/objectid"
	_ "github.com/hoangtrung1801/loom/loom-heart/core/block/import/markdown"
	_ "github.com/hoangtrung1801/loom/loom-heart/core/block/import/pb"
	_ "github.com/hoangtrung1801/loom/loom-heart/core/block/import/web"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/process"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain/objectorigin"
	"github.com/hoangtrung1801/loom/loom-heart/core/event"
	"github.com/hoangtrung1801/loom/loom-heart/core/files/filesync"
	"github.com/hoangtrung1801/loom/loom-heart/core/notifications"
	"github.com/hoangtrung1801/loom/loom-heart/pb"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/localstore/objectstore"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
	"github.com/hoangtrung1801/loom/loom-heart/space"
)

type ImportRequest struct {
	*pb.RpcObjectImportRequest
	Origin           objectorigin.ObjectOrigin
	Progress         process.Progress
	SendNotification bool
	IsSync           bool
}

type ImportResponse struct {
	RootCollectionId string
	RootWidgetLayout model.BlockContentWidgetLayout
	ProcessId        string
	ObjectsCount     int64
	Err              error
}

type Dependencies struct {
	converters          map[string]common.Converter
	blockService        *block.Service
	objectCreator       creator.Service
	idProvider          objectid.IdAndKeyProvider
	fileSync            filesync.FileSync
	notificationService notifications.Notifications
	eventSender         event.Sender
	objectStore         objectstore.ObjectStore
	spaceService        space.Service
}

// Importer encapsulate logic with import
type Importer interface {
	app.Component
	Import(ctx context.Context, importRequest *ImportRequest) *ImportResponse

	ListImports(req *pb.RpcObjectImportListRequest) ([]*pb.RpcObjectImportListImportResponse, error)
	ImportWeb(ctx context.Context, req *ImportRequest) (string, *domain.Details, error)
	// nolint: lll
	ValidateNotionToken(ctx context.Context, req *pb.RpcObjectImportNotionValidateTokenRequest) (pb.RpcObjectImportNotionValidateTokenResponseErrorCode, error)
}
