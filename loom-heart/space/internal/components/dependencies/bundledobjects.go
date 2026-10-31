package dependencies

import (
	"context"

	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/space/clientspace"
)

type BundledObjectsInstaller interface {
	InstallBundledObjects(ctx context.Context, spc clientspace.Space, ids []string) ([]string, []*domain.Details, error)
	BundledObjectsIdsToInstall(ctx context.Context, spc clientspace.Space, sourceObjectIds []string) (ids domain.BundledObjectIds, err error)
}
