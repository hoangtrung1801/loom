package csv

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/block/import/common"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/process"
	"github.com/hoangtrung1801/loom/loom-heart/pb"
)

type Strategy interface {
	CreateObjects(path string, csvTable [][]string, params *pb.RpcObjectImportRequestCsvParams, progress process.Progress) (string, []*common.Snapshot, error)
}
