package core

import (
	"context"
	"fmt"
	"time"

	"github.com/hoangtrung1801/loom/loom-heart/pb"
	"github.com/hoangtrung1801/loom/loom-heart/util/linkpreview"
	"github.com/hoangtrung1801/loom/loom-heart/util/uri"
)

func (mw *Middleware) LinkPreview(cctx context.Context, req *pb.RpcLinkPreviewRequest) *pb.RpcLinkPreviewResponse {
	ctx, cancel := context.WithTimeout(cctx, time.Second*5)
	defer cancel()

	u, err := uri.NormalizeAndParseURI(req.Url)
	if err != nil {
		return &pb.RpcLinkPreviewResponse{
			Error: &pb.RpcLinkPreviewResponseError{
				Code:        pb.RpcLinkPreviewResponseError_UNKNOWN_ERROR,
				Description: fmt.Sprintf("failed to parse url: %v", getErrorDescription(err)),
			},
		}
	}

	data, _, _, err := mustService[linkpreview.LinkPreview](mw).Fetch(ctx, u.String(), false)
	if err != nil {
		code := mapErrorCode(err,
			errToCode(linkpreview.ErrPrivateLink, pb.RpcLinkPreviewResponseError_PRIVATE_LINK),
		)
		return &pb.RpcLinkPreviewResponse{
			Error: &pb.RpcLinkPreviewResponseError{
				Code:        code,
				Description: getErrorDescription(err),
			},
		}
	}

	return &pb.RpcLinkPreviewResponse{
		Error: &pb.RpcLinkPreviewResponseError{
			Code: pb.RpcLinkPreviewResponseError_NULL,
		},
		LinkPreview: &data,
	}
}
