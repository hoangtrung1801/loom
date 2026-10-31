package dependencies

import "github.com/hoangtrung1801/loom/loom-heart/space/clientspace"

type BuiltinTemplateService interface {
	RegisterBuiltinTemplates(space clientspace.Space) error
}
