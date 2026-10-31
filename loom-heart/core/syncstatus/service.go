package syncstatus

/*
AI generated

Name: File Sync Status Indexer
Scope: global

## Responsibility
- Listen to file sync status changes and update FileBackupStatus detail on file objects
*/

import (
	"context"
	"fmt"

	"github.com/anyproto/any-sync/app"

	"github.com/hoangtrung1801/loom/loom-heart/core/block/cache"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/smartblock"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/core/files/filesync"
	"github.com/hoangtrung1801/loom/loom-heart/core/syncstatus/filesyncstatus"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/bundle"
)

const CName = "status"

type Service interface {
	app.ComponentRunnable
}

var _ Service = (*service)(nil)

type service struct {
	fileSyncService filesync.FileSync
	objectGetter    cache.ObjectGetter
}

func New() Service {
	return &service{}
}

func (s *service) Init(a *app.App) (err error) {
	s.fileSyncService = app.MustComponent[filesync.FileSync](a)
	s.objectGetter = app.MustComponent[cache.ObjectGetter](a)
	s.fileSyncService.OnStatusUpdated(s.onStatusUpdated)
	return nil
}

func (s *service) Run(ctx context.Context) (err error) {
	return
}

func (s *service) Name() string {
	return CName
}

func (s *service) Close(ctx context.Context) (err error) {
	return nil
}

func (s *service) onStatusUpdated(objectId string, _ domain.FullFileId, status filesyncstatus.Status) error {
	return s.indexFileSyncStatus(objectId, status)
}

func (s *service) indexFileSyncStatus(fileObjectId string, status filesyncstatus.Status) error {
	err := cache.Do(s.objectGetter, fileObjectId, func(sb smartblock.SmartBlock) (err error) {
		prevStatus := sb.Details().GetInt64(bundle.RelationKeyFileBackupStatus)
		newStatus := int64(status)
		if prevStatus == newStatus || prevStatus == int64(filesyncstatus.Synced) {
			return nil
		}
		st := sb.NewState()
		st.SetDetailAndBundledRelation(bundle.RelationKeyFileBackupStatus, domain.Int64(newStatus))
		return sb.Apply(st)
	})
	if err != nil {
		return fmt.Errorf("get object: %w", err)
	}
	return nil
}
