package dependencies

import (
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/threads"
)

type MigrationService interface {
	RunMigrationsWhenIdle(spaceId string, derivedIDs threads.DerivedSmartblockIds)
}
