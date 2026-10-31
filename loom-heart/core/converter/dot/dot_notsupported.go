//go:build gomobile || windows || nographviz || ignore || !cgo
// +build gomobile windows nographviz ignore !cgo

package dot

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/smartblock"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/state"
	"github.com/hoangtrung1801/loom/loom-heart/core/converter"
	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/core/relationutils"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
	"github.com/hoangtrung1801/loom/loom-heart/space/spacecore/typeprovider"
)

func NewMultiConverter(format int, _ typeprovider.SmartBlockTypeProvider) converter.MultiConverter {
	return &dot{}
}

const (
	ExportFormatDOT = 0
	ExportFormatSVG = 1
)

type edgeType int

const (
	EdgeTypeRelation edgeType = iota
	EdgeTypeLink
)

type dot struct {
}

func (d *dot) SetKnownDocs(docs map[string]*domain.Details) converter.Converter {
	return d
}

func (d *dot) Add(space smartblock.Space, st *state.State, fetcher relationutils.RelationFormatFetcher) error {
	return nil
}

func (d *dot) Convert(sbType model.SmartBlockType) []byte {
	panic("not supported on windows")
	return nil
}

func (d *dot) Ext() string {
	return ""
}
