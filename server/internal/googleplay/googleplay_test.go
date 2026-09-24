package googleplay_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	packageName = "com.example.reader"
	productID   = "episode_300"
	token       = "opaque-token-up-to-150-chars.AO-J1Oy"
	accountID   = "0192f7a6-3c5e-7b3a-9d2e-1f0a2b3c4d5e"
)

func key(t *testing.T) []byte {
	return []byte(testutil.ServiceAccountJSON(t, "reader-app", "publira@reader-app.iam.gserviceaccount.com"))
}

func TestGetProductPurchaseReadsTheRecordedPurchase(t *testing.T) {
	server := googleplaytest.NewServer(t)
	server.Put(t, packageName, productID, token, googleplaytest.Purchased, accountID)

	got, err := server.Client().GetProductPurchase(context.Background(), key(t), packageName, productID, token)
	if err != nil {
		t.Fatalf("GetProductPurchase: %v", err)
	}
	if got.PurchaseState != googleplay.PurchaseStatePurchased || got.ObfuscatedExternalAccountID != accountID || got.IsTest() {
		t.Fatalf("GetProductPurchase = %+v, want a paid purchase for %s", got, accountID)
	}
}

func TestGetProductPurchaseTellsALicenseTestersPurchase(t *testing.T) {
	server := googleplaytest.NewServer(t)
	server.Put(t, packageName, productID, token, googleplaytest.TestPurchase, accountID)

	got, err := server.Client().GetProductPurchase(context.Background(), key(t), packageName, productID, token)
	if err != nil {
		t.Fatalf("GetProductPurchase: %v", err)
	}
	if !got.IsTest() {
		t.Fatalf("GetProductPurchase = %+v, want a test purchase", got)
	}
}

func TestGetProductPurchaseAnswersNotFoundForAnotherProduct(t *testing.T) {
	server := googleplaytest.NewServer(t)
	server.Put(t, packageName, productID, token, googleplaytest.Purchased, accountID)

	_, err := server.Client().GetProductPurchase(context.Background(), key(t), packageName, "episode_100", token)
	if !errors.Is(err, googleplay.ErrPurchaseNotFound) {
		t.Fatalf("error = %v, want ErrPurchaseNotFound", err)
	}
}

func TestConsumeProductPurchaseConsumesThePurchase(t *testing.T) {
	server := googleplaytest.NewServer(t)
	server.Put(t, packageName, productID, token, googleplaytest.Purchased, accountID)
	client := server.Client()

	if err := client.ConsumeProductPurchase(context.Background(), key(t), packageName, productID, token); err != nil {
		t.Fatalf("ConsumeProductPurchase: %v", err)
	}
	got, err := client.GetProductPurchase(context.Background(), key(t), packageName, productID, token)
	if err != nil {
		t.Fatalf("GetProductPurchase: %v", err)
	}
	if got.ConsumptionState != googleplay.ConsumptionStateConsumed || server.Consumes(packageName, productID, token) != 1 {
		t.Fatalf("after consuming: %+v, %d consumes", got, server.Consumes(packageName, productID, token))
	}
}

func TestRequestsClassifyTheStoresAnswers(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		want   error
	}{
		{name: "refused service account", status: http.StatusForbidden, want: googleplay.ErrUnauthorized},
		{name: "gone purchase", status: http.StatusGone, want: googleplay.ErrPurchaseNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"access_token":"t","token_type":"Bearer","expires_in":3600}`))
					return
				}
				w.WriteHeader(tc.status)
			}))
			defer server.Close()
			client := googleplay.NewClient(googleplay.Config{Endpoint: server.URL, TokenURL: server.URL + "/token"})
			if _, err := client.GetProductPurchase(context.Background(), key(t), packageName, productID, token); !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestRequestsReportAnOutageAsNeitherRefusal(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"t","token_type":"Bearer","expires_in":3600}`))
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	client := googleplay.NewClient(googleplay.Config{Endpoint: server.URL, TokenURL: server.URL + "/token"})
	_, err := client.GetProductPurchase(context.Background(), key(t), packageName, productID, token)
	if err == nil || errors.Is(err, googleplay.ErrPurchaseNotFound) || errors.Is(err, googleplay.ErrUnauthorized) {
		t.Fatalf("error = %v, want a plain error", err)
	}
}

func TestRequestsRefuseAKeyThatIsNoServiceAccount(t *testing.T) {
	_, err := googleplay.NewClient(googleplay.Config{}).GetProductPurchase(context.Background(), []byte("{}"), packageName, productID, token)
	if !errors.Is(err, googleplay.ErrInvalidCredentials) {
		t.Fatalf("error = %v, want ErrInvalidCredentials", err)
	}
}
