package appstore_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/appstore/appstoretest"
)

func transaction() appstoretest.Transaction {
	return appstoretest.Transaction{
		TransactionID:         "2000000123456789",
		OriginalTransactionID: "2000000123456789",
		BundleID:              "com.example.reader",
		ProductID:             "episode_300",
		Type:                  appstore.TypeConsumable,
		AppAccountToken:       "0192f7a6-3c5e-7b3a-9d2e-1f0a2b3c4d5e",
		Environment:           appstore.EnvironmentProduction,
		PurchaseDate:          time.Now().UnixMilli(),
		SignedDate:            time.Now().UnixMilli(),
	}
}

func TestVerifyTransactionReadsATransactionSignedByATrustedChain(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	got, err := signer.Verifier().VerifyTransaction(signer.Sign(t, transaction()))
	if err != nil {
		t.Fatalf("VerifyTransaction: %v", err)
	}
	want := appstore.Transaction{
		TransactionID:         "2000000123456789",
		OriginalTransactionID: "2000000123456789",
		BundleID:              "com.example.reader",
		ProductID:             "episode_300",
		Type:                  appstore.TypeConsumable,
		AppAccountToken:       "0192f7a6-3c5e-7b3a-9d2e-1f0a2b3c4d5e",
		Environment:           appstore.EnvironmentProduction,
	}
	if got != want {
		t.Fatalf("VerifyTransaction = %+v, want %+v", got, want)
	}
}

func TestVerifyTransactionRefusesWhatATrustedChainDidNotSign(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	signed := signer.Sign(t, transaction())
	parts := strings.Split(signed, ".")
	other := strings.Split(signer.Sign(t, appstoretest.Transaction{TransactionID: "1", BundleID: "com.example.reader", ProductID: "episode_100"}), ".")

	for name, input := range map[string]string{
		"a payload swapped under the signature": parts[0] + "." + other[1] + "." + parts[2],
		"a chain from another root":             appstoretest.NewSigner(t).Sign(t, transaction()),
		"a chain without Apple's markers":       appstoretest.NewUnmarkedSigner(t).Sign(t, transaction()),
		"no signature":                          parts[0] + "." + parts[1] + ".",
		"not a JWS":                             "not-a-jws",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := signer.Verifier().VerifyTransaction(input); !errors.Is(err, appstore.ErrInvalidSignature) {
				t.Fatalf("VerifyTransaction error = %v, want ErrInvalidSignature", err)
			}
		})
	}
}

func TestVerifyTransactionRefusesAPayloadThatIsNoTransaction(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	_, err := signer.Verifier().VerifyTransaction(signer.Sign(t, map[string]string{"notificationType": "TEST"}))
	if !errors.Is(err, appstore.ErrMalformed) {
		t.Fatalf("VerifyTransaction error = %v, want ErrMalformed", err)
	}
}

func TestNewVerifierTrustsOnlyApple(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	if _, err := appstore.NewVerifier().VerifyTransaction(signer.Sign(t, transaction())); !errors.Is(err, appstore.ErrInvalidSignature) {
		t.Fatalf("VerifyTransaction error = %v, want ErrInvalidSignature", err)
	}
}

func credentials(t *testing.T) appstore.Credentials {
	return appstore.Credentials{
		IssuerID:         "57246542-96fe-1a63-e053-0824d011072a",
		KeyID:            "2X9R4HXF34",
		PrivateKey:       appstoretest.PrivateKeyPEM(t),
		BundleIdentifier: "com.example.reader",
	}
}

func TestGetTransactionInfoSignsItsRequestAndAsksTheTransactionsEnvironment(t *testing.T) {
	creds := credentials(t)
	block, _ := pem.Decode([]byte(creds.PrivateKey))
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("parse key: %v", err)
	}
	publicKey := &parsed.(*ecdsa.PrivateKey).PublicKey

	var sandboxHits int
	sandbox := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sandboxHits++
		if r.URL.Path != "/inApps/v1/transactions/2000000123456789" {
			t.Errorf("path = %q", r.URL.Path)
		}
		token, err := jwt.Parse(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), func(*jwt.Token) (any, error) {
			return publicKey, nil
		}, jwt.WithValidMethods([]string{"ES256"}), jwt.WithAudience("appstoreconnect-v1"), jwt.WithIssuer(creds.IssuerID))
		if err != nil {
			t.Errorf("request token does not verify: %v", err)
		} else {
			if token.Header["kid"] != creds.KeyID {
				t.Errorf("kid = %v, want %q", token.Header["kid"], creds.KeyID)
			}
			if bid := token.Claims.(jwt.MapClaims)["bid"]; bid != creds.BundleIdentifier {
				t.Errorf("bid = %v, want %q", bid, creds.BundleIdentifier)
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"signedTransactionInfo": "signed"})
	}))
	defer sandbox.Close()
	production := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("a sandbox transaction reached the production endpoint")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer production.Close()

	client := appstore.NewClient(appstore.Config{ProductionEndpoint: production.URL, SandboxEndpoint: sandbox.URL})
	got, err := client.GetTransactionInfo(context.Background(), creds, appstore.EnvironmentSandbox, "2000000123456789")
	if err != nil {
		t.Fatalf("GetTransactionInfo: %v", err)
	}
	if got != "signed" || sandboxHits != 1 {
		t.Fatalf("GetTransactionInfo = %q after %d requests, want the signed transaction after one", got, sandboxHits)
	}
}

func TestGetTransactionInfoClassifiesTheStoresRefusals(t *testing.T) {
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
		_, err := client.GetTransactionInfo(context.Background(), credentials(t), appstore.EnvironmentProduction, "1")
		server.Close()
		if !errors.Is(err, tc.want) {
			t.Errorf("status %d: error = %v, want %v", tc.status, err, tc.want)
		}
	}
}

func TestGetTransactionInfoReportsAnOutageAsNeitherRefusal(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	client := appstore.NewClient(appstore.Config{ProductionEndpoint: server.URL})
	_, err := client.GetTransactionInfo(context.Background(), credentials(t), appstore.EnvironmentProduction, "1")
	if err == nil || errors.Is(err, appstore.ErrTransactionNotFound) || errors.Is(err, appstore.ErrUnauthorized) {
		t.Fatalf("error = %v, want a plain error", err)
	}
}

func TestGetTransactionInfoRefusesCredentialsThatCannotSign(t *testing.T) {
	creds := credentials(t)
	creds.PrivateKey = "not a key"
	_, err := appstore.NewClient(appstore.Config{}).GetTransactionInfo(context.Background(), creds, appstore.EnvironmentProduction, "1")
	if !errors.Is(err, appstore.ErrInvalidCredentials) {
		t.Fatalf("error = %v, want ErrInvalidCredentials", err)
	}
}

func TestVerifyNotificationReadsTheRefundAndItsSignedTransaction(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	verifier := signer.Verifier()
	signed := signer.Sign(t, appstoretest.Notification{
		NotificationType: appstore.NotificationTypeRefund,
		NotificationUUID: "0f1c6e1a-6c3b-4d5e-9f00-2b1d6b7a8c9d",
		Version:          "2.0",
		SignedDate:       time.Now().UnixMilli(),
		Data: appstoretest.NotificationData{
			BundleID:              "com.example.reader",
			Environment:           appstore.EnvironmentProduction,
			SignedTransactionInfo: signer.Sign(t, transaction()),
		},
	})

	notification, err := verifier.VerifyNotification(signed)
	if err != nil {
		t.Fatalf("VerifyNotification: %v", err)
	}
	if notification.NotificationType != appstore.NotificationTypeRefund || notification.Data.BundleID != "com.example.reader" {
		t.Fatalf("VerifyNotification = %+v", notification)
	}
	refunded, err := verifier.VerifyTransaction(notification.Data.SignedTransactionInfo)
	if err != nil || refunded.TransactionID != "2000000123456789" {
		t.Fatalf("the notification's transaction = %+v, %v", refunded, err)
	}
}

func TestVerifyNotificationRefusesOneAnotherChainSigned(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	signed := appstoretest.NewSigner(t).Sign(t, appstoretest.Notification{
		NotificationType: appstore.NotificationTypeRefund,
		NotificationUUID: "0f1c6e1a-6c3b-4d5e-9f00-2b1d6b7a8c9d",
	})
	if _, err := signer.Verifier().VerifyNotification(signed); !errors.Is(err, appstore.ErrInvalidSignature) {
		t.Fatalf("VerifyNotification error = %v, want ErrInvalidSignature", err)
	}
}
