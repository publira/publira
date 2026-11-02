package publicapi

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/dataexport"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storage/storagetest"
	"github.com/publira/publira/server/internal/testutil"
)

// newDataExportDBEnv is a public API server whose readers' archives are kept
// in bucket, or that has no object store when bucket is nil.
func newDataExportDBEnv(t *testing.T, guards readerGuards, bucket *storagetest.Memory) *publicDBEnv {
	t.Helper()
	return newPublicDBEnvConfigured(t, guards, openMailGuard(), func(api *apiServer, _ *sql.DB) {
		if bucket != nil {
			api.storage = bucket
			api.objects = bucket
		}
	})
}

// buildDataExports runs the worker's pass over the requests waiting, as the
// maintenance role.
func buildDataExports(t *testing.T, env *publicDBEnv, bucket *storagetest.Memory) {
	t.Helper()
	if _, err := dataexport.RunPending(context.Background(), dataexport.Deps{DB: env.PG.OpenContentStatsDB(t), Storage: bucket, Reclaimers: bucket}); err != nil {
		t.Fatalf("RunPending: %v", err)
	}
}

// download reads the whole of DownloadMyDataExport.
func download(ctx context.Context, env *publicDBEnv, tenant testutil.Tenant) ([]byte, error) {
	stream, err := env.authClient().DownloadMyDataExport(ctx, &publirav1.DownloadMyDataExportRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		return nil, err
	}
	defer stream.Close() //nolint:errcheck
	var archive bytes.Buffer
	for {
		piece, err := stream.Receive()
		if errors.Is(err, io.EOF) {
			return archive.Bytes(), nil
		}
		if err != nil {
			return nil, err
		}
		archive.Write(piece.GetData())
	}
}

// A reader asks for their archive, sees it pending, and once the worker has
// built it downloads it, any number of times, while no other reader of the
// tenant can.
func TestDBDataExportIsRequestedBuiltAndDownloadedByItsReaderAlone(t *testing.T) {
	t.Parallel()
	bucket := storagetest.NewMemory()
	env := newDataExportDBEnv(t, openReaderGuards(), bucket)
	tenant := env.seedTenant(t, "TENANTDEX1", "data-export-1.example.com", "Data Export 1")
	reader := env.PG.SeedEndUser(t, tenant.ID, "READERDEX1", "reader@data-export-1.example.com", "Reader")
	other := env.PG.SeedEndUser(t, tenant.ID, "READERDEX2", "other@data-export-1.example.com", "Other")
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader))
	otherCtx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, other))
	client := env.authClient()

	none, err := client.GetMyDataExport(ctx, &publirav1.GetMyDataExportRequest{Tenant: tenantContext(tenant)})
	if err != nil || none.GetDataExport() != nil {
		t.Fatalf("GetMyDataExport before asking = %v, %v, want none", none, err)
	}

	requested, err := client.RequestMyDataExport(ctx, &publirav1.RequestMyDataExportRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("RequestMyDataExport: %v", err)
	}
	if got := requested.GetDataExport(); got.GetState() != publirav1.DataExportState_DATA_EXPORT_STATE_PENDING || got.GetRequestedAt() == "" || got.GetExpiresAt() != "" {
		t.Fatalf("requested = %v, want pending", got)
	}

	_, err = client.RequestMyDataExport(ctx, &publirav1.RequestMyDataExportRequest{Tenant: tenantContext(tenant)})
	if reason, _ := errorInfoReason(err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonDataExportInProgress {
		t.Fatalf("a second request while one is open = %v (reason %q), want failed_precondition %s", err, reason, rpcerrors.ReasonDataExportInProgress)
	}
	if _, err := download(ctx, env, tenant); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DownloadMyDataExport while pending = %v, want not_found", err)
	}

	buildDataExports(t, env, bucket)

	ready, err := client.GetMyDataExport(ctx, &publirav1.GetMyDataExportRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("GetMyDataExport once built: %v", err)
	}
	if got := ready.GetDataExport(); got.GetState() != publirav1.DataExportState_DATA_EXPORT_STATE_READY || got.GetReadyAt() == "" || got.GetExpiresAt() == "" || got.GetSizeBytes() == 0 {
		t.Fatalf("data export once built = %v, want ready with its expiry and size", got)
	}

	keys := bucket.Keys()
	if len(keys) != 1 {
		t.Fatalf("bucket = %v, want the one archive", keys)
	}
	stored, _ := bucket.Object(keys[0])
	for range 2 {
		archive, err := download(ctx, env, tenant)
		if err != nil {
			t.Fatalf("DownloadMyDataExport: %v", err)
		}
		if !bytes.Equal(archive, stored) {
			t.Fatalf("downloaded %d bytes, want the %d stored", len(archive), len(stored))
		}
		if _, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive))); err != nil {
			t.Fatalf("downloaded archive is not a ZIP: %v", err)
		}
	}

	if _, err := download(otherCtx, env, tenant); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DownloadMyDataExport by another reader = %v, want not_found", err)
	}
	if got, err := client.GetMyDataExport(otherCtx, &publirav1.GetMyDataExportRequest{Tenant: tenantContext(tenant)}); err != nil || got.GetDataExport() != nil {
		t.Fatalf("GetMyDataExport by another reader = %v, %v, want none", got, err)
	}
}

// With no object store there is nowhere to keep an archive, so the request is
// refused rather than left pending.
func TestDBDataExportIsRefusedWithoutAnObjectStore(t *testing.T) {
	t.Parallel()
	env := newDataExportDBEnv(t, openReaderGuards(), nil)
	tenant := env.seedTenant(t, "TENANTDEX2", "data-export-2.example.com", "Data Export 2")
	reader := env.PG.SeedEndUser(t, tenant.ID, "READERDEX3", "reader@data-export-2.example.com", "Reader")
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader))

	_, err := env.authClient().RequestMyDataExport(ctx, &publirav1.RequestMyDataExportRequest{Tenant: tenantContext(tenant)})
	if reason, _ := errorInfoReason(err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonStorageNotConfigured {
		t.Fatalf("RequestMyDataExport with no object store = %v (reason %q), want failed_precondition %s", err, reason, rpcerrors.ReasonStorageNotConfigured)
	}
	if n := env.countRows(t, "SELECT count(*) FROM user_data_exports"); n != 0 {
		t.Fatalf("data exports = %d, want none recorded", n)
	}
}

// A request is charged against the platform policy's data_export limit, one a
// day unless the operator says otherwise, and a refused one records nothing.
func TestDBDataExportIsChargedAgainstThePlatformPolicy(t *testing.T) {
	t.Parallel()
	bucket := storagetest.NewMemory()
	env := newDataExportDBEnv(t, guardsWith(func(p *platformpolicy.Policy) {
		p.DataExport = platformpolicy.Defaults().DataExport
	}), bucket)
	tenant := env.seedTenant(t, "TENANTDEX3", "data-export-3.example.com", "Data Export 3")
	reader := env.PG.SeedEndUser(t, tenant.ID, "READERDEX4", "reader@data-export-3.example.com", "Reader")
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader))
	client := env.authClient()

	if _, err := client.RequestMyDataExport(ctx, &publirav1.RequestMyDataExportRequest{Tenant: tenantContext(tenant)}); err != nil {
		t.Fatalf("RequestMyDataExport: %v", err)
	}
	buildDataExports(t, env, bucket)

	_, err := client.RequestMyDataExport(ctx, &publirav1.RequestMyDataExportRequest{Tenant: tenantContext(tenant)})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a second request the same day = %v, want resource_exhausted", err)
	}
	if n := env.countRows(t, "SELECT count(*) FROM user_data_exports"); n != 1 {
		t.Fatalf("data exports = %d, want the first alone", n)
	}
}
