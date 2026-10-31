package objectid

import (
	"context"
	"strings"
	"time"

	"github.com/anyproto/any-sync/commonspace/object/tree/treestorage"

	"github.com/hoangtrung1801/loom/loom-heart/core/block/import/common"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain/objectorigin"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/bundle"
)

type participant struct{}

func newParticipant() *participant {
	return &participant{}
}

func (w *participant) GetIDAndPayload(ctx context.Context, spaceID string, sn *common.Snapshot, _ time.Time, _ bool, _ objectorigin.ObjectOrigin) (string, treestorage.TreeStorageCreatePayload, error) {
	participantId := sn.Snapshot.Data.Details.GetString(bundle.RelationKeyId)
	splitId := strings.Split(participantId, "_")
	identity := splitId[len(splitId)-1]
	newParticipantID := domain.NewParticipantId(spaceID, identity)
	return newParticipantID, treestorage.TreeStorageCreatePayload{}, nil
}
