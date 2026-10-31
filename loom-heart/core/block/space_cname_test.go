package block

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/hoangtrung1801/loom/loom-heart/space"
)

// The space service looks the block service up by a copied name (importing
// this package would be a cycle); if the constants drift, the head-sync
// sweep silently loses its opened-spaces priority.
func TestSpaceBlockServiceCNameInSync(t *testing.T) {
	assert.Equal(t, CName, space.BlockServiceCName)
}
