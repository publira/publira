package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ageverification"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenanttz"
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

// key names the filtered list a cursor points into, so a token issued for
// another filter is refused.
func (filters readerListFilters) key() pagination.ListKey {
	return pagination.NewListKey("created_at_desc").
		Value("query", filters.query.String).
		Value("status", filters.status.String)
}

func adminReader(row readerRow) *publiraadminv1.AdminReader {
	return &publiraadminv1.AdminReader{
		PublicId:        row.PublicID,
		Name:            row.Name,
		Email:           row.Email,
		Status:          row.Status,
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
		EmailVerifiedAt: formatOptionalTime(row.EmailVerifiedAt),
		BirthDate:       formatOptionalBirthDate(row.BirthDate),
	}
}

func formatOptionalBirthDate(birthDate sql.NullTime) string {
	if !birthDate.Valid {
		return ""
	}
	return ageverification.FormatBirthDate(birthDate.Time)
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
	listKey := filters.key()
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = listKey.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
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
			res.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, and only once:
	// when the recovery query is itself empty the boundary row is gone too, so
	// both tokens stay empty and the client starts over from the first page.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
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

// errReaderUnchanged is what a reader action's write returns when its statement
// matched no row, so the transaction rolls back without an audit entry.
var errReaderUnchanged = errors.New("reader unchanged")

// changeReader commits a reader action and its audit entry together, because a
// retried action records nothing and so cannot make up for a dropped entry.
func (s *adminServer) changeReader(
	ctx context.Context,
	headers http.Header,
	sessionCtx rpcmiddleware.SessionContext,
	action, readerPublicID string,
	write func(queries *dbmodels.Queries) error,
) error {
	tenantID := sessionCtx.Tenant.ID.String()
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return s.internalDBError(ctx, "failed to begin reader transaction", err, "tenant_id", tenantID, "action", action)
	}
	defer tx.Rollback() //nolint:errcheck

	queries := dbmodels.New(tx)
	if err := write(queries); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errReaderUnchanged
		}
		return s.internalDBError(ctx, "failed to change reader", err, "tenant_id", tenantID, "action", action, "public_id", readerPublicID)
	}
	if err := auditlog.WriteTenant(ctx, queries, s.logger, auditlog.TenantEntry{
		TenantID:    sessionCtx.Tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  "user",
		TargetID:    readerPublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(headers),
	}); err != nil {
		return s.internalDBError(ctx, "failed to record reader action", err, "tenant_id", tenantID, "action", action, "public_id", readerPublicID)
	}
	if err := tx.Commit(); err != nil {
		return s.internalDBError(ctx, "failed to commit reader action", err, "tenant_id", tenantID, "action", action, "public_id", readerPublicID)
	}
	return nil
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

	var updated dbmodels.SuspendTenantReaderRow
	err = s.changeReader(ctx, req.Header(), sessionCtx, "reader_suspended", publicID, func(queries *dbmodels.Queries) error {
		updated, err = queries.SuspendTenantReader(ctx, dbmodels.SuspendTenantReaderParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			PublicID: publicID,
		})
		return err
	})
	if errors.Is(err, errReaderUnchanged) {
		// Either no such reader or one already suspended; the read tells which.
		row, err := s.tenantReader(ctx, tenant.ID, publicID)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&publiraadminv1.SuspendReaderResponse{Reader: adminReader(row)}), nil
	}
	if err != nil {
		return nil, err
	}

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

	var updated dbmodels.UnsuspendTenantReaderRow
	err = s.changeReader(ctx, req.Header(), sessionCtx, "reader_unsuspended", publicID, func(queries *dbmodels.Queries) error {
		updated, err = queries.UnsuspendTenantReader(ctx, dbmodels.UnsuspendTenantReaderParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			PublicID: publicID,
		})
		return err
	})
	if errors.Is(err, errReaderUnchanged) {
		// Either no such reader or one who is not suspended; the read tells which.
		row, err := s.tenantReader(ctx, tenant.ID, publicID)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&publiraadminv1.UnsuspendReaderResponse{Reader: adminReader(row)}), nil
	}
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.UnsuspendReaderResponse{Reader: adminReader(readerRow(updated))}), nil
}

// SetReaderBirthDate sets or clears a reader's birth date. The age gates read
// the stored date on every request, so nothing issued before the change needs
// revoking.
func (s *adminServer) SetReaderBirthDate(
	ctx context.Context,
	req *connect.Request[publiraadminv1.SetReaderBirthDateRequest],
) (*connect.Response[publiraadminv1.SetReaderBirthDateResponse], error) {
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

	var birthDate sql.NullTime
	action := "reader_birth_date_cleared"
	if raw := strings.TrimSpace(req.Msg.BirthDate); raw != "" {
		today, err := s.tenantToday(ctx, tenant)
		if err != nil {
			return nil, s.internalError(ctx, "failed to resolve the tenant calendar day", err, "tenant_id", tenant.ID.String())
		}
		parsed, err := ageverification.ParseBirthDate(raw, today)
		if err != nil {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "birth_date")
		}
		birthDate = sql.NullTime{Time: parsed, Valid: true}
		action = "reader_birth_date_changed"
	}

	var updated dbmodels.SetTenantReaderBirthDateRow
	err = s.changeReader(ctx, req.Header(), sessionCtx, action, publicID, func(queries *dbmodels.Queries) error {
		updated, err = queries.SetTenantReaderBirthDate(ctx, dbmodels.SetTenantReaderBirthDateParams{
			BirthDate: birthDate,
			TenantID:  uuid.NullUUID{UUID: tenant.ID, Valid: true},
			PublicID:  publicID,
		})
		return err
	})
	if errors.Is(err, errReaderUnchanged) {
		// Either no such reader or one whose date is already this; the read
		// tells which.
		row, err := s.tenantReader(ctx, tenant.ID, publicID)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&publiraadminv1.SetReaderBirthDateResponse{Reader: adminReader(row)}), nil
	}
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.SetReaderBirthDateResponse{Reader: adminReader(readerRow(updated))}), nil
}

// tenantToday is the calendar day the tenant is living through, which is what
// the storefront counts a reader's age against and so what bounds a date.
func (s *adminServer) tenantToday(ctx context.Context, tenant dbmodels.Tenant) (time.Time, error) {
	zone := tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx)))
	location, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, fmt.Errorf("load tenant time zone %q: %w", zone, err)
	}
	return ageverification.Today(time.Now(), location), nil
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

	err = s.changeReader(ctx, req.Header(), sessionCtx, "reader_deleted", publicID, func(queries *dbmodels.Queries) error {
		_, err := queries.DeleteTenantReader(ctx, dbmodels.DeleteTenantReaderParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			PublicID: publicID,
		})
		return err
	})
	if errors.Is(err, errReaderUnchanged) {
		return nil, readerNotFoundError()
	}
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.DeleteReaderResponse{PublicId: publicID}), nil
}
