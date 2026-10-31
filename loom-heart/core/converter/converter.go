package converter

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/smartblock"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/state"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/core/relationutils"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
)

type Converter interface {
	Convert(sbType model.SmartBlockType) (result []byte)
	SetKnownDocs(docs map[string]*domain.Details) Converter
	Ext() string
}

type MultiConverter interface {
	Converter
	Add(space smartblock.Space, state *state.State, fetcher relationutils.RelationFormatFetcher) error
}
