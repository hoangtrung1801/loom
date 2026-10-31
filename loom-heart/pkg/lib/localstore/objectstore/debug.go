package objectstore

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/hoangtrung1801/loom/loom-heart/core/domain"
	"github.com/hoangtrung1801/loom/loom-heart/util/debug"
)

func (s *dsObjectStore) DebugRouter(r chi.Router) {
	r.Get("/details/{id}", debug.JSONHandler(s.debugDetails))
}

func (s *dsObjectStore) debugDetails(req *http.Request) (*domain.Details, error) {
	// id := chi.URLParam(req, "id")
	return nil, fmt.Errorf("not implemented")
	// return s.GetDetails("TODO", id)
}
