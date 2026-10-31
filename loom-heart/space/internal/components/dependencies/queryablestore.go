package dependencies

import "github.com/hoangtrung1801/loom/loom-heart/pkg/lib/database"

type QueryableStore interface {
	Query(q database.Query) (records []database.Record, err error)
}
