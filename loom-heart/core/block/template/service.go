package template

import (
	"context"
	"errors"

	"github.com/anyproto/any-sync/app"

	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/smartblock"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/state"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/core/session"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
	"github.com/hoangtrung1801/loom/loom-heart/space/clientspace"
)

type CreateTemplateRequest struct {
	SpaceId, TemplateId, TypeId string
	Layout                      model.ObjectTypeLayout
	Details                     *domain.Details
	WithTemplateValidation      bool
}

func (r CreateTemplateRequest) IsValid() error {
	if r.WithTemplateValidation && (r.SpaceId == "" || r.TypeId == "") {
		return errors.New("spaceId and typeId are expected to resolve valid templateId")
	}
	return nil
}

type Service interface {
	CreateTemplateStateWithDetails(req CreateTemplateRequest) (st *state.State, err error)
	CreateTemplateStateFromSmartBlock(sb smartblock.SmartBlock, req CreateTemplateRequest) *state.State
	ObjectApplyTemplate(contextId string, templateId string) error
	TemplateCreateFromObject(ctx context.Context, id string) (templateId string, err error)

	TemplateCloneInSpace(space clientspace.Space, id string) (templateId string, err error)
	TemplateClone(spaceId string, id string) (templateId string, err error)

	TemplateExportAll(ctx context.Context, path string) (string, error)

	GetTemplatePlaceholders(templateId string) ([]*model.Placeholder, error)
	SetTemplatePlaceholders(ctx session.Context, templateId string, placeholders []*model.Placeholder) error
	DeleteTemplatePlaceholders(ctx session.Context, templateId string, relationKeys []string) error

	app.Component
}
