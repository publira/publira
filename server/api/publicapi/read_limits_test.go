package publicapi

import (
	"net/http"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/DATA-DOG/go-sqlmock"
	"google.golang.org/protobuf/proto"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/testutil"
)

func newReadLimitHandler(t *testing.T) (http.Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return mustPublicHandler(t, db, dbmodels.New(db), nil), mock
}

// Every procedure reads at most its bound of one request, and one byte more is
// refused while it is read, before anything decodes it: the namespace is
// reached without a session. A request of exactly the bound is read and then
// fails to decode, which is what tells the two apart.
func TestReadLimitsBoundEveryProcedure(t *testing.T) {
	handler, _ := newReadLimitHandler(t)
	bounds := map[string]int{
		publirav1connect.CatalogServiceListPublishedSeriesProcedure:    rpcmiddleware.DefaultReadMaxBytes,
		publirav1connect.ContactServiceSubmitContactMessageProcedure:   rpcmiddleware.DefaultReadMaxBytes,
		publirav1connect.PurchaseServiceProcessPaymentWebhookProcedure: rpcmiddleware.DefaultReadMaxBytes,
		publirav1connect.DomainServiceGetTenantByDomainProcedure:       rpcmiddleware.DefaultReadMaxBytes,
	}
	for procedure, bound := range readLimits {
		bounds[procedure] = bound
	}
	for procedure, bound := range bounds {
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

// Every webhook is read whole at the largest payload it is documented to take,
// and reaches the handler, which looks up the tenant it names and refuses it
// here for naming none, rather than being refused for its size.
func TestReadLimitsAdmitTheLargestDocumentedWebhook(t *testing.T) {
	tenant := &publirattypesv1.TenantContext{TenantId: "00000000-0000-0000-0000-000000000001"}
	headers := map[string]string{
		"Content-Type":     "application/json",
		"Stripe-Signature": "t=1700000000,v1=" + strings.Repeat("0", 64),
		"User-Agent":       "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
	}
	webhooks := map[string]proto.Message{
		publirav1connect.PurchaseServiceProcessPaymentWebhookProcedure: &publirav1.ProcessPaymentWebhookRequest{
			Tenant: tenant, Provider: "stripe", Payload: make([]byte, maxPaymentWebhookPayload), Headers: headers,
		},
		publirav1connect.PurchaseServiceProcessAppStoreNotificationProcedure: &publirav1.ProcessAppStoreNotificationRequest{
			Tenant: tenant, Payload: make([]byte, maxPaymentWebhookPayload),
		},
		publirav1connect.ContactServiceProcessInboundEmailWebhookProcedure: &publirav1.ProcessInboundEmailWebhookRequest{
			Tenant: tenant, Provider: "sendgrid", Payload: make([]byte, maxInboundEmailWebhookPayload), Headers: headers,
		},
	}
	for procedure, req := range webhooks {
		t.Run(procedure, func(t *testing.T) {
			handler, mock := newReadLimitHandler(t)
			mock.ExpectQuery("FROM tenants").WillReturnRows(sqlmock.NewRows(nil))
			if got := testutil.RequestCode(t, handler, procedure, req); got != connect.CodeNotFound {
				t.Errorf("a webhook of %d bytes: %v, want not_found", proto.Size(req), got)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("the tenant the webhook names was not looked up: %v", err)
			}
		})
	}
}
