package platformapi

import (
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/DATA-DOG/go-sqlmock"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/testutil"
)

// Every procedure reads at most rpcmiddleware.DefaultReadMaxBytes of one
// request, and one byte more is refused while it is read, before anything
// decodes it: signing in and the first-run setup are reached without a
// session. A request of exactly the bound is read and then fails to decode,
// which is what tells the two apart.
func TestReadLimitsBoundEveryProcedure(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	handler := newTestHandler(db, dbmodels.New(db))

	bound := rpcmiddleware.DefaultReadMaxBytes
	for _, procedure := range []string{
		publirasplatformv1connect.PlatformAuthServiceLoginProcedure,
		publirasplatformv1connect.PlatformAuthServiceRequestPasswordResetProcedure,
		publirasplatformv1connect.PlatformSetupServiceCheckSetupStatusProcedure,
	} {
		t.Run(procedure, func(t *testing.T) {
			if got := testutil.ReadLimitCode(t, handler, procedure, int64(bound)); got != connect.CodeInvalidArgument {
				t.Errorf("a request of %d bytes: %v, want it read and then refused as invalid_argument", bound, got)
			}
			if got := testutil.ReadLimitCode(t, handler, procedure, int64(bound)+1); got != connect.CodeResourceExhausted {
				t.Errorf("a request of %d bytes: %v, want resource_exhausted", bound+1, got)
			}
		})
	}
}
