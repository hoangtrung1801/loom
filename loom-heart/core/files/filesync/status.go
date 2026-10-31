package filesync

import (
	"go.uber.org/zap"

	"github.com/hoangtrung1801/loom/loom-heart/core/syncstatus/filesyncstatus"
)

func (s *fileSync) updateStatus(it FileInfo, status filesyncstatus.Status) error {
	for _, cb := range s.onStatusUpdated {
		err := cb(it.ObjectId, it.FullFileId(), status)
		if err != nil {
			if !isObjectDeletedError(err) {
				log.Warn("on status update callback failed",
					zap.String("spaceId", it.SpaceId),
					zap.String("fileObjectId", it.ObjectId),
					zap.String("fileId", it.FileId.String()),
					zap.Error(err))
			}
			return err
		}
	}
	return nil
}
