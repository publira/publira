package publicapi

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

// A config that cannot be read is not a tenant without an app: answering none
// would have the storefront publish a missing association.
func TestGetTenantMobileAppAssociationFailsWhenTheConfigCannotBeRead(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(errors.New("connection reset"))

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.GetTenantMobileAppAssociation(context.Background(), &publirav1.GetTenantMobileAppAssociationRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want internal (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicExpectations(t, mock)
}
