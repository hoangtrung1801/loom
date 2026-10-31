package spaceinfo

import (
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
)

type ParticipantAclInfo struct {
	Id          string
	SpaceId     string
	Identity    string
	Permissions model.ParticipantPermissions
	Status      model.ParticipantStatus
}

type OneToOneParticipantData struct {
	Identity           string
	RequestMetadataKey []byte // a.k.a RequestMetadata, symKey
}
