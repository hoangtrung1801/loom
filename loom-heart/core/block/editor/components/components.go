package components

import "github.com/hoangtrung1801/loom/loom-heart/core/domain"

type SyncStatusHandler interface {
	HandleSyncStatusUpdate(heads []string, status domain.ObjectSyncStatus, syncError domain.SyncError)
}
