package pb

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/block/collection"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/import/common"
	"github.com/hoangtrung1801/loom/loom-heart/pb"
)

type CollectionProvider interface {
	ProvideCollection(
		snapshots *common.SnapshotContext,
		oldToNewID map[string]string,
		params *pb.RpcObjectImportRequestPbParams,
		isNewSpace bool,
	) ([]*common.Snapshot, error)
}

func GetProvider(importType pb.RpcObjectImportRequestPbParamsType, service *collection.Service) CollectionProvider {
	if importType == pb.RpcObjectImportRequestPbParams_EXPERIENCE {
		return NewGalleryImport(service)
	}
	return NewSpaceImport(service)
}
