package relationutils

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/bundle"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
)

func OptionFromDetails(det *domain.Details) *Option {
	return &Option{
		RelationOption: &model.RelationOption{
			Id:          det.GetString(bundle.RelationKeyId),
			Text:        det.GetString(bundle.RelationKeyName),
			Color:       det.GetString(bundle.RelationKeyRelationOptionColor),
			RelationKey: det.GetString(bundle.RelationKeyRelationKey),
			OrderId:     det.GetString(bundle.RelationKeyOrderId),
		},
	}
}

type Option struct {
	*model.RelationOption
}
