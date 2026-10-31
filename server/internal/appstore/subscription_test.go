package appstore_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/appstore/appstoretest"
)

func TestVerifyRenewalInfoReadsTheRenewalOfASubscription(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	got, err := signer.Verifier().VerifyRenewalInfo(signer.Sign(t, appstoretest.RenewalInfo{
		OriginalTransactionID:  "2000000123456789",
		ProductID:              "plan_monthly",
		AutoRenewProductID:     "plan_monthly",
		AutoRenewStatus:        appstore.AutoRenewOff,
		Environment:            appstore.EnvironmentSandbox,
		GracePeriodExpiresDate: 1758787200000,
		SignedDate:             time.Now().UnixMilli(),
	}))
	if err != nil {
		t.Fatalf("VerifyRenewalInfo: %v", err)
	}
	want := appstore.RenewalInfo{
		OriginalTransactionID:  "2000000123456789",
		ProductID:              "plan_monthly",
		AutoRenewStatus:        appstore.AutoRenewOff,
		Environment:            appstore.EnvironmentSandbox,
		GracePeriodExpiresDate: 1758787200000,
	}
	if got != want {
		t.Fatalf("VerifyRenewalInfo = %+v, want %+v", got, want)
	}
}

func TestVerifyRenewalInfoRefusesWhatATrustedChainDidNotSign(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	signed := appstoretest.NewSigner(t).Sign(t, appstoretest.RenewalInfo{OriginalTransactionID: "2000000123456789"})
	if _, err := signer.Verifier().VerifyRenewalInfo(signed); !errors.Is(err, appstore.ErrInvalidSignature) {
		t.Fatalf("VerifyRenewalInfo error = %v, want ErrInvalidSignature", err)
	}
}

func TestVerifyRenewalInfoRefusesAPayloadThatIsNoRenewal(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	if _, err := signer.Verifier().VerifyRenewalInfo(signer.Sign(t, map[string]string{"notificationType": "TEST"})); !errors.Is(err, appstore.ErrMalformed) {
		t.Fatalf("VerifyRenewalInfo error = %v, want ErrMalformed", err)
	}
}

func TestGetAllSubscriptionStatusesAnswersTheSubscriptionsOfEveryGroup(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/inApps/v1/subscriptions/2000000123456789" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Error("the request carries no token")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"environment": appstore.EnvironmentSandbox,
			"bundleId":    "com.example.reader",
			"data": []map[string]any{
				{
					"subscriptionGroupIdentifier": "21000001",
					"lastTransactions": []map[string]any{
						{"originalTransactionId": "2000000123456789", "status": appstore.SubscriptionStatusActive, "signedTransactionInfo": "transaction-1", "signedRenewalInfo": "renewal-1"},
					},
				},
				{
					"subscriptionGroupIdentifier": "21000002",
					"lastTransactions": []map[string]any{
						{"originalTransactionId": "2000000987654321", "status": appstore.SubscriptionStatusExpired, "signedTransactionInfo": "transaction-2", "signedRenewalInfo": "renewal-2"},
					},
				},
			},
		})
	}))
	defer server.Close()

	client := appstore.NewClient(appstore.Config{SandboxEndpoint: server.URL})
	got, err := client.GetAllSubscriptionStatuses(context.Background(), credentials(t), appstore.EnvironmentSandbox, "2000000123456789")
	if err != nil {
		t.Fatalf("GetAllSubscriptionStatuses: %v", err)
	}
	want := []appstore.SubscriptionStatus{
		{OriginalTransactionID: "2000000123456789", Status: appstore.SubscriptionStatusActive, SignedTransactionInfo: "transaction-1", SignedRenewalInfo: "renewal-1"},
		{OriginalTransactionID: "2000000987654321", Status: appstore.SubscriptionStatusExpired, SignedTransactionInfo: "transaction-2", SignedRenewalInfo: "renewal-2"},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("GetAllSubscriptionStatuses = %+v, want %+v", got, want)
	}
}

func TestGetAllSubscriptionStatusesClassifiesTheStoresRefusals(t *testing.T) {
	for _, tc := range []struct {
		status int
		want   error
	}{
		{status: http.StatusNotFound, want: appstore.ErrTransactionNotFound},
		{status: http.StatusUnauthorized, want: appstore.ErrUnauthorized},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
		}))
		client := appstore.NewClient(appstore.Config{ProductionEndpoint: server.URL})
		_, err := client.GetAllSubscriptionStatuses(context.Background(), credentials(t), appstore.EnvironmentProduction, "1")
		server.Close()
		if !errors.Is(err, tc.want) {
			t.Errorf("status %d: error = %v, want %v", tc.status, err, tc.want)
		}
	}
}
