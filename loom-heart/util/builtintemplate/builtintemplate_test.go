package builtintemplate

import (
	"context"
	"testing"

	"github.com/anyproto/any-sync/app"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/hoangtrung1801/loom/loom-heart/core/anytype/config"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/source/mock_source"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/localstore/addr"
	"github.com/hoangtrung1801/loom/loom-heart/pkg/lib/localstore/objectstore"
	"github.com/hoangtrung1801/loom/loom-heart/space/clientspace/mock_clientspace"
	"github.com/hoangtrung1801/loom/loom-heart/tests/testutil"
)

func Test_registerBuiltin(t *testing.T) {
	sourceService := mock_source.NewMockService(t)
	sourceService.EXPECT().NewStaticSource(mock.Anything).Return(nil).Maybe()
	sourceService.EXPECT().RegisterStaticSource(mock.Anything).Return(nil).Maybe()

	marketplaceSpace := mock_clientspace.NewMockSpace(t)
	marketplaceSpace.EXPECT().Id().Return(addr.AnytypeMarketplaceWorkspace)
	marketplaceSpace.EXPECT().Do(mock.Anything, mock.Anything).Return(nil)

	objectStore := objectstore.NewStoreFixture(t)

	builtInTemplates := New()

	ctx := context.Background()
	a := new(app.App)
	a.Register(testutil.PrepareMock(ctx, a, sourceService))
	a.Register(builtInTemplates)
	a.Register(config.New())
	a.Register(objectStore)

	err := builtInTemplates.Init(a)
	assert.NoError(t, err)
	err = builtInTemplates.RegisterBuiltinTemplates(marketplaceSpace)
	assert.NoError(t, err)
}
