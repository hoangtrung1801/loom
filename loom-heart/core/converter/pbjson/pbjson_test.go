package pbjson

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/state"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/template"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/pb/model"
)

func TestPbc_Convert(t *testing.T) {
	s := state.NewDoc("root", nil).(*state.State)
	template.InitTemplate(s, template.WithTitle)
	c := NewConverter(s)
	result := c.Convert(model.SmartBlockType_Page)
	assert.NotEmpty(t, result)
}
