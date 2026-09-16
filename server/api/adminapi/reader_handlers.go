package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

const (
	defaultReaderListLimit = int32(20)
	maxReaderListLimit     = int32(100)
)

// readerRow is the single shape every reader the console reads arrives in: the
// list queries and the single read select the same columns in the same order.
type readerRow = dbmodels.GetTenantReaderByPublicIDRow

// normalizeReaderStatusFilter accepts the three stored account states and
// nothing else, so a typo never widens the list to every reader.
func normalizeReaderStatusFilter(raw string) (sql.NullString, error) {
	status := strings.TrimSpace(raw)
	switch status {
	case "":
		return sql.NullString{}, nil
	case "active", "suspended", "inactive":
		return sql.NullString{String: status, Valid: true}, nil
	default:
		return sql.NullString{}, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			errors.New("status is not a reader status"),
			"status",
		)
	}
}

func adminReader(row readerRow) *publiraadminv1.AdminReader {
	return &publiraadminv1.AdminReader{
		PublicId:        row.PublicID,
		Name:            row.Name,
		Email:           row.Email,
		Status:          row.Status,
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
		EmailVerifiedAt: formatOptionalTime(row.EmailVerifiedAt),
		HasBirthDate:    row.HasBirthDate,
	}
}

// readerPage runs the keyset query for one page. The list reads newest first,
// so a backward page is scanned by the ascending query and put back into display
// order by pagination.Page.
func (s *adminServer) readerPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keyword, status sql.NullString,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]readerRow, error) {
	params := dbmodels.ListTenantReadersDescParams{
		TenantID:        uuid.NullUUID{UUID: tenantID, Valid: true},
		Query:           keyword,
		Status:          status,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	}
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListTenantReadersAsc(ctx, dbmodels.ListTenantReadersAscParams(params))
		if err != nil {
			return nil, err
		}
		mapped := make([]readerRow, 0, len(rows))
		for _, row := range rows {
			mapped = append(mapped, readerRow(row))
		}
		return mapped, nil
	}
	rows, err := queries.ListTenantReadersDesc(ctx, params)
	if err != nil {
		return nil, err
	}
	mapped := make([]readerRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, readerRow(row))
	}
	return mapped, nil
}

// ListReaders returns the tenant's readers, newest first. The rows carry each
// reader's email, so only a tenant admin may read them.
func (s *adminServer) ListReaders(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListReadersRequest],
) (*connect.Response[publiraadminv1.ListReadersResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	status, err := normalizeReaderStatusFilter(req.Msg.Status)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultReaderListLimit, maxReaderListLimit)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	query := strings.TrimSpace(req.Msg.Query)
	keyword := sql.NullString{String: query, Valid: query != ""}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.readerPage(ctx, tenant.ID, keyword, status, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list readers", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	readers := make([]*publiraadminv1.AdminReader, 0, len(rows))
	for _, row := range rows {
		readers = append(readers, adminReader(row))
	}

	res := &publiraadminv1.ListReadersResponse{Readers: readers}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, and only once:
	// when the recovery query is itself empty the boundary row is gone too, so
	// both tokens stay empty and the client starts over from the first page.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

// GetReader reads one reader of the tenant, gated like ListReaders.
func (s *adminServer) GetReader(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetReaderRequest],
) (*connect.Response[publiraadminv1.GetReaderResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("public_id is required"), "public_id")
	}

	row, err := s.queriesFor(ctx).GetTenantReaderByPublicID(ctx, dbmodels.GetTenantReaderByPublicIDParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		PublicID: publicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("reader not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get reader", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.GetReaderResponse{Reader: adminReader(row)}), nil
}
