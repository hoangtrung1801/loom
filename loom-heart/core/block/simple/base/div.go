package base

import (
	"fmt"

	"github.com/hoangtrung1801/loom/loom-heart/core/block/simple"
	"github.com/hoangtrung1801/loom/loom-heart/core/event"
	"github.com/hoangtrung1801/loom/loom-heart/pb"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
	"github.com/hoangtrung1801/loom/loom-heart/util/pbtypes"
)

func NewDiv(m *model.Block) simple.Block {
	return &Div{
		Base:    NewBase(m).(*Base),
		content: m.GetDiv(),
	}
}

type DivBlock interface {
	simple.Block
	SetStyle(style model.BlockContentDivStyle)
	ApplyEvent(e *pb.EventBlockSetDiv) (err error)
}

type Div struct {
	*Base
	content *model.BlockContentDiv
}

func (b *Div) Diff(spaceId string, block simple.Block) (msgs []simple.EventMessage, err error) {
	div, ok := block.(*Div)
	if !ok {
		return nil, fmt.Errorf("can't make diff with different block type")
	}
	if msgs, err = b.Base.Diff(spaceId, div); err != nil {
		return
	}
	changes := &pb.EventBlockSetDiv{
		Id: div.Id,
	}
	hasChanges := false

	if b.content.Style != div.content.Style {
		hasChanges = true
		changes.Style = &pb.EventBlockSetDivStyle{Value: div.content.Style}
	}
	if hasChanges {
		msgs = append(msgs, simple.EventMessage{Msg: event.NewMessage(spaceId, &pb.EventMessageValueOfBlockSetDiv{BlockSetDiv: changes})})
	}
	return
}

func (b *Div) Copy() simple.Block {
	return NewDiv(pbtypes.CopyBlock(b.Model()))
}

func (b *Div) SetStyle(style model.BlockContentDivStyle) {
	b.content.Style = style
}

// Validate TODO: add validation rules
func (b *Div) Validate() error {
	return nil
}

func (d *Div) ApplyEvent(e *pb.EventBlockSetDiv) (err error) {
	if e.Style != nil {
		d.content.Style = e.Style.GetValue()
	}
	return
}
