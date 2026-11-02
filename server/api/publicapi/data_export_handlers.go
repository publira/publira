package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

// dataExportChunkSize is how much of an archive one message of
// DownloadMyDataExport carries: far below what a client reads of one message,
// and large enough that an archive of a few megabytes is a few dozen of them.
const dataExportChunkSize = 64 << 10

// errDataExportInProgress refuses a request while the reader's last one is
// still being built.
var errDataExportInProgress = errors.New("a data export is already being prepared")

// RequestMyDataExport records the reader's request for an archive of what the
// install keeps about them, which the worker builds.
//
// The request still open and the object store are checked before the flood
// control is charged: a refusal for either stores nothing, and charging for it
// would spend the day's one request on an archive that was never asked for.
func (s *apiServer) RequestMyDataExport(
	ctx context.Context,
	req *publirav1.RequestMyDataExportRequest,
) (*publirav1.RequestMyDataExportResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := s.scopeReaderStateUser(ctx, user.ID); err != nil {
		return nil, err
	}
	queries := s.queriesFor(ctx)
	latest, err := queries.GetLatestUserDataExport(ctx, dbmodels.GetLatestUserDataExportParams{
		TenantID: tenant.ID,
		UserID:   uuid.NullUUID{UUID: user.ID, Valid: true},
		Now:      time.Now(),
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the latest data export", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err == nil && dataExportState(latest) == publirav1.DataExportState_DATA_EXPORT_STATE_PENDING {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errDataExportInProgress, rpcerrors.ReasonDataExportInProgress)
	}
	if store, err := storage.Pin(ctx, s.storage); errors.Is(err, storage.ErrNotConfigured) || (err == nil && store == nil) {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, storage.ErrNotConfigured, rpcerrors.ReasonStorageNotConfigured)
	} else if err != nil {
		return nil, s.internalError(ctx, "failed to resolve the object store", err, "tenant_id", tenant.ID.String())
	}
	if err := s.chargeReaderAction(ctx, actionRequestDataExport, tenant.ID, user.ID); err != nil {
		return nil, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, s.internalError(ctx, "failed to allocate a data export id", err)
	}
	created, err := queries.CreateUserDataExport(ctx, dbmodels.CreateUserDataExportParams{
		ID:       id,
		TenantID: tenant.ID,
		UserID:   uuid.NullUUID{UUID: user.ID, Valid: true},
	})
	// Another request of the reader's committed between the read and the
	// insert.
	if errors.Is(err, sql.ErrNoRows) {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errDataExportInProgress, rpcerrors.ReasonDataExportInProgress)
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the data export", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	return noStorePrivateResponse(ctx, &publirav1.RequestMyDataExportResponse{DataExport: dataExportToProto(created)}), nil
}

// GetMyDataExport answers the reader's latest request that has not expired.
func (s *apiServer) GetMyDataExport(
	ctx context.Context,
	req *publirav1.GetMyDataExportRequest,
) (*publirav1.GetMyDataExportResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := s.scopeReaderStateUser(ctx, user.ID); err != nil {
		return nil, err
	}
	latest, err := s.queriesFor(ctx).GetLatestUserDataExport(ctx, dbmodels.GetLatestUserDataExportParams{
		TenantID: tenant.ID,
		UserID:   uuid.NullUUID{UUID: user.ID, Valid: true},
		Now:      time.Now(),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return noStorePrivateResponse(ctx, &publirav1.GetMyDataExportResponse{}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the latest data export", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	return noStorePrivateResponse(ctx, &publirav1.GetMyDataExportResponse{DataExport: dataExportToProto(latest)}), nil
}

// DownloadMyDataExport streams the reader's latest ready archive from the
// bucket as it is stored, a piece at a time, so the server holds no more of
// it than one piece.
func (s *apiServer) DownloadMyDataExport(
	ctx context.Context,
	req *publirav1.DownloadMyDataExportRequest,
	stream publirav1connect.AuthServiceDownloadMyDataExportServerStream,
) error {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return err
	}
	if err := s.scopeReaderStateUser(ctx, user.ID); err != nil {
		return err
	}
	ready, err := s.queriesFor(ctx).GetDownloadableUserDataExport(ctx, dbmodels.GetDownloadableUserDataExportParams{
		TenantID: tenant.ID,
		UserID:   uuid.NullUUID{UUID: user.ID, Valid: true},
		Now:      time.Now(),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return connect.NewError(connect.CodeNotFound, "no data export is ready")
	}
	if err != nil {
		return s.internalDBError(ctx, "failed to read the ready data export", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if s.objects == nil {
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, storage.ErrNotConfigured, rpcerrors.ReasonStorageNotConfigured)
	}
	body, err := s.objects.Open(ctx, ready.ObjectKey.String)
	switch {
	case errors.Is(err, storage.ErrNotConfigured):
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, storage.ErrNotConfigured, rpcerrors.ReasonStorageNotConfigured)
	case errors.Is(err, storage.ErrObjectNotFound):
		// The row outlived its archive, as one does when the bucket was
		// swapped for another. There is nothing to hand the reader.
		return connect.NewError(connect.CodeNotFound, "no data export is ready").WithCause(err)
	case err != nil:
		return s.internalError(ctx, "failed to open the data export", err, "tenant_id", tenant.ID.String(), "data_export_id", ready.ID.String())
	}
	defer body.Close() //nolint:errcheck

	markNoStorePrivate(ctx)
	buf := make([]byte, dataExportChunkSize)
	for {
		n, readErr := io.ReadFull(body, buf)
		if n > 0 {
			if err := stream.Send(&publirav1.DownloadMyDataExportResponse{Data: buf[:n]}); err != nil {
				return err
			}
		}
		if errors.Is(readErr, io.EOF) || errors.Is(readErr, io.ErrUnexpectedEOF) {
			return nil
		}
		if readErr != nil {
			return s.internalError(ctx, "failed to read the data export", readErr, "tenant_id", tenant.ID.String(), "data_export_id", ready.ID.String())
		}
	}
}

// dataExportState names what has become of a request.
func dataExportState(row dbmodels.UserDataExport) publirav1.DataExportState {
	switch {
	case row.ReadyAt.Valid:
		return publirav1.DataExportState_DATA_EXPORT_STATE_READY
	case row.FailedAt.Valid:
		return publirav1.DataExportState_DATA_EXPORT_STATE_FAILED
	default:
		return publirav1.DataExportState_DATA_EXPORT_STATE_PENDING
	}
}

func dataExportToProto(row dbmodels.UserDataExport) *publirav1.DataExport {
	export := &publirav1.DataExport{
		State:       dataExportState(row),
		RequestedAt: row.RequestedAt.UTC().Format(time.RFC3339),
		SizeBytes:   row.SizeBytes.Int64,
	}
	if row.ReadyAt.Valid {
		export.ReadyAt = row.ReadyAt.Time.UTC().Format(time.RFC3339)
	}
	if row.ExpiresAt.Valid {
		export.ExpiresAt = row.ExpiresAt.Time.UTC().Format(time.RFC3339)
	}
	return export
}
