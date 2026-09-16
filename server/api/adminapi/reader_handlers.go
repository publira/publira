package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
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

// readerListFilters holds the optional narrowing of the reader list in the
// shape the keyset queries accept.
type readerListFilters struct {
	query  sql.NullString
	status sql.NullString
}

func (filters readerListFilters) active() bool {
	return filters.query.Valid || filters.status.Valid
}

// key names the filtered list a cursor points into, so a token issued for
// another filter is refused. The query is escaped so that no search text can
// spell another filter.
func (filters readerListFilters) key() string {
	key := "created_at_desc"
	if filters.query.Valid {
		key += "+query:" + url.QueryEscape(filters.query.String)
	}
	if filters.status.Valid {
		key += "+status:" + filters.status.String
	}
	return key
}

func encodeReaderListToken(direction pagination.Direction, filters readerListFilters, at time.Time, id uuid.UUID) string {
	if !filters.active() {
		return pagination.EncodeTimeUUID(direction, at, id)
	}
	return pagination.Encode(direction, filters.key(), at.UTC().Format(time.RFC3339Nano), id.String())
}

func encodeReaderListRecoveryToken(direction pagination.Direction, filters readerListFilters, keys pagination.TimeUUIDKeys) string {
	if !filters.active() {
		return pagination.EncodeTimeUUIDRecovery(direction, keys.Time, keys.ID)
	}
	return pagination.Encode(direction, filters.key(), keys.Time.UTC().Format(time.RFC3339Nano), keys.ID.String(), "inclusive")
}

func decodeReaderListCursor(cursor pagination.Cursor, filters readerListFilters) (pagination.TimeUUIDKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if !filters.active() {
		keys, err := pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return pagination.TimeUUIDKeys{}, invalid
		}
		return keys, nil
	}
	if len(cursor.Keys) != 3 && len(cursor.Keys) != 4 {
		return pagination.TimeUUIDKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 4
	if inclusive && cursor.Keys[3] != "inclusive" {
		return pagination.TimeUUIDKeys{}, invalid
	}
	if cursor.Keys[0] != filters.key() {
		return pagination.TimeUUIDKeys{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token was issued for another filter"))
	}
	at, err := time.Parse(time.RFC3339Nano, cursor.Keys[1])
	if err != nil {
		return pagination.TimeUUIDKeys{}, invalid
	}
	id, err := uuid.Parse(cursor.Keys[2])
	if err != nil {
		return pagination.TimeUUIDKeys{}, invalid
	}
	return pagination.TimeUUIDKeys{Time: at.UTC(), ID: id, Inclusive: inclusive, Valid: true}, nil
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
	filters readerListFilters,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]readerRow, error) {
	params := dbmodels.ListTenantReadersDescParams{
		TenantID:        uuid.NullUUID{UUID: tenantID, Valid: true},
		Query:           filters.query,
		Status:          filters.status,
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
	query := strings.TrimSpace(req.Msg.Query)
	filters := readerListFilters{
		query:  sql.NullString{String: query, Valid: query != ""},
		status: status,
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultReaderListLimit, maxReaderListLimit)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = decodeReaderListCursor(cursor, filters)
		if err != nil {
			return nil, err
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.readerPage(ctx, tenant.ID, filters, keys, cursor.Direction, limit+1)
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
			res.PreviousToken = encodeReaderListToken(pagination.Backward, filters, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = encodeReaderListToken(pagination.Forward, filters, last.CreatedAt, last.ID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, and only once:
	// when the recovery query is itself empty the boundary row is gone too, so
	// both tokens stay empty and the client starts over from the first page.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = encodeReaderListRecoveryToken(pagination.Backward, filters, keys)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = encodeReaderListRecoveryToken(pagination.Forward, filters, keys)
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

	publicID, err := readerPublicIDArg(req.Msg.PublicId)
	if err != nil {
		return nil, err
	}
	row, err := s.tenantReader(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.GetReaderResponse{Reader: adminReader(row)}), nil
}

func readerPublicIDArg(raw string) (string, error) {
	publicID := strings.TrimSpace(raw)
	if publicID == "" {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("public_id is required"), "public_id")
	}
	return publicID, nil
}

func (s *adminServer) tenantReader(ctx context.Context, tenantID uuid.UUID, publicID string) (readerRow, error) {
	row, err := s.queriesFor(ctx).GetTenantReaderByPublicID(ctx, dbmodels.GetTenantReaderByPublicIDParams{
		TenantID: uuid.NullUUID{UUID: tenantID, Valid: true},
		PublicID: publicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return readerRow{}, readerNotFoundError()
		}
		return readerRow{}, s.internalDBError(ctx, "failed to get reader", err, "tenant_id", tenantID.String())
	}
	return row, nil
}

func readerNotFoundError() error {
	return connect.NewError(connect.CodeNotFound, errors.New("reader not found"))
}

// recordReaderAudit names the reader by public id, which still identifies the
// row after DeleteReader has removed the account it points at.
func (s *adminServer) recordReaderAudit(ctx context.Context, headers http.Header, sessionCtx rpcmiddleware.SessionContext, action, readerPublicID string) {
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    sessionCtx.Tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  "user",
		TargetID:    readerPublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(headers),
	})
}

// SuspendReader suspends a reader of the tenant. The credentials_version bump
// in the same statement is what keeps a token issued before the suspension
// refused after UnsuspendReader.
func (s *adminServer) SuspendReader(
	ctx context.Context,
	req *connect.Request[publiraadminv1.SuspendReaderRequest],
) (*connect.Response[publiraadminv1.SuspendReaderResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	publicID, err := readerPublicIDArg(req.Msg.PublicId)
	if err != nil {
		return nil, err
	}

	updated, err := s.queriesFor(ctx).SuspendTenantReader(ctx, dbmodels.SuspendTenantReaderParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		PublicID: publicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Either no such reader or one already suspended; the read tells which.
		row, err := s.tenantReader(ctx, tenant.ID, publicID)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&publiraadminv1.SuspendReaderResponse{Reader: adminReader(row)}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to suspend reader", err, "tenant_id", tenant.ID.String(), "public_id", publicID)
	}

	s.recordReaderAudit(ctx, req.Header(), sessionCtx, "reader_suspended", publicID)
	return connect.NewResponse(&publiraadminv1.SuspendReaderResponse{Reader: adminReader(readerRow(updated))}), nil
}

// UnsuspendReader lifts a suspension of a reader of the tenant.
func (s *adminServer) UnsuspendReader(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UnsuspendReaderRequest],
) (*connect.Response[publiraadminv1.UnsuspendReaderResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	publicID, err := readerPublicIDArg(req.Msg.PublicId)
	if err != nil {
		return nil, err
	}

	updated, err := s.queriesFor(ctx).UnsuspendTenantReader(ctx, dbmodels.UnsuspendTenantReaderParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		PublicID: publicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Either no such reader or one who is not suspended; the read tells which.
		row, err := s.tenantReader(ctx, tenant.ID, publicID)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&publiraadminv1.UnsuspendReaderResponse{Reader: adminReader(row)}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to unsuspend reader", err, "tenant_id", tenant.ID.String(), "public_id", publicID)
	}

	s.recordReaderAudit(ctx, req.Header(), sessionCtx, "reader_unsuspended", publicID)
	return connect.NewResponse(&publiraadminv1.UnsuspendReaderResponse{Reader: adminReader(readerRow(updated))}), nil
}

// DeleteReader deletes a reader of the tenant with the same statement DeleteMe
// ends in, so the rows that go with the account are decided by the same
// foreign keys.
func (s *adminServer) DeleteReader(
	ctx context.Context,
	req *connect.Request[publiraadminv1.DeleteReaderRequest],
) (*connect.Response[publiraadminv1.DeleteReaderResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	publicID, err := readerPublicIDArg(req.Msg.PublicId)
	if err != nil {
		return nil, err
	}

	if _, err := s.queriesFor(ctx).DeleteTenantReader(ctx, dbmodels.DeleteTenantReaderParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		PublicID: publicID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, readerNotFoundError()
		}
		return nil, s.internalDBError(ctx, "failed to delete reader", err, "tenant_id", tenant.ID.String(), "public_id", publicID)
	}

	s.recordReaderAudit(ctx, req.Header(), sessionCtx, "reader_deleted", publicID)
	return connect.NewResponse(&publiraadminv1.DeleteReaderResponse{PublicId: publicID}), nil
}
