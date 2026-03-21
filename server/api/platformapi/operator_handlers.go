package platformapi

import (
	"context"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
)

func (s *platformServer) ListOperators(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListPlatformOperatorsRequest],
) (*connect.Response[publirasplatformv1.ListPlatformOperatorsResponse], error) {
	if _, _, _, err := s.authenticatePlatformSession(ctx, req.Msg.SessionId, req.Header()); err != nil {
		return nil, err
	}
	rows, err := s.queries.ListPlatformOperators(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &publirasplatformv1.ListPlatformOperatorsResponse{
		Operators: make([]*publirasplatformv1.PlatformOperator, len(rows)),
	}
	for index, row := range rows {
		resp.Operators[index] = &publirasplatformv1.PlatformOperator{
			PublicId:  row.PublicID,
			Name:      row.Name,
			Email:     row.Email,
			Role:      row.Role,
			Status:    row.Status,
			CreatedAt: row.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		}
	}
	return connect.NewResponse(resp), nil
}
