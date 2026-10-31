package googleplay_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
)

const (
	pushAudience       = "https://comics.example.com/api/v1/webhook/payment/google-play"
	pushServiceAccount = "publira@reader-app.iam.gserviceaccount.com"
)

func TestVerifyPushTakesOnlyATokenGoogleSignedForTheEndpointAndTheAccount(t *testing.T) {
	issuer := googleplaytest.NewIssuer(t)
	verifier := issuer.Verifier()
	ctx := context.Background()

	if err := verifier.VerifyPush(ctx, issuer.Authorization(t, pushAudience, pushServiceAccount), pushAudience, pushServiceAccount); err != nil {
		t.Fatalf("VerifyPush of a token for the endpoint and the account: %v", err)
	}
	for name, authorization := range map[string]string{
		"no token":                   "",
		"not a bearer":               "Basic dXNlcjpwYXNz",
		"another audience":           issuer.Authorization(t, "https://other.example.com/api/v1/webhook/payment/google-play", pushServiceAccount),
		"another service account":    issuer.Authorization(t, pushAudience, "someone@other-project.iam.gserviceaccount.com"),
		"a key Google does not hold": googleplaytest.NewIssuer(t).Authorization(t, pushAudience, pushServiceAccount),
	} {
		t.Run(name, func(t *testing.T) {
			if err := verifier.VerifyPush(ctx, authorization, pushAudience, pushServiceAccount); !errors.Is(err, googleplay.ErrInvalidPushToken) {
				t.Fatalf("VerifyPush = %v, want ErrInvalidPushToken", err)
			}
		})
	}
}

func TestVerifyPushRefusesAnExpiredToken(t *testing.T) {
	issuer := googleplaytest.NewIssuer(t)
	authorization := issuer.Authorization(t, pushAudience, pushServiceAccount)
	later := googleplay.NewPushVerifier(googleplay.PushConfig{
		CertsURL: issuer.CertsURL(),
		Now:      func() time.Time { return time.Now().Add(2 * time.Hour) },
	})
	if err := later.VerifyPush(context.Background(), authorization, pushAudience, pushServiceAccount); !errors.Is(err, googleplay.ErrInvalidPushToken) {
		t.Fatalf("VerifyPush of an expired token = %v, want ErrInvalidPushToken", err)
	}
}

// Keys that cannot be read are not a token that does not verify: the push is
// one Google may well have signed, and is retried rather than refused.
func TestVerifyPushReportsKeysItCannotReadApartFromATokenThatDoesNotVerify(t *testing.T) {
	issuer := googleplaytest.NewIssuer(t)
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(down.Close)
	verifier := googleplay.NewPushVerifier(googleplay.PushConfig{CertsURL: down.URL})
	err := verifier.VerifyPush(context.Background(), issuer.Authorization(t, pushAudience, pushServiceAccount), pushAudience, pushServiceAccount)
	if err == nil || errors.Is(err, googleplay.ErrInvalidPushToken) {
		t.Fatalf("VerifyPush with Google's keys unreadable = %v, want an error other than ErrInvalidPushToken", err)
	}
}

func TestParsePushReadsTheNotificationOfTheMessage(t *testing.T) {
	push, err := googleplay.ParsePush(googleplaytest.PushBody(t, map[string]any{
		"version":         "1.0",
		"packageName":     "com.example.reader",
		"eventTimeMillis": "1761292800000",
		"subscriptionNotification": map[string]any{
			"version":          "1.0",
			"notificationType": 2,
			"purchaseToken":    "play-token.AO-J1Oy",
		},
	}))
	if err != nil {
		t.Fatalf("ParsePush: %v", err)
	}
	got := push.Notification
	if got.PackageName != "com.example.reader" || got.SubscriptionNotification == nil ||
		got.SubscriptionNotification.NotificationType != 2 || got.SubscriptionNotification.PurchaseToken != "play-token.AO-J1Oy" {
		t.Fatalf("ParsePush = %+v, want the renewal of play-token.AO-J1Oy in com.example.reader", got)
	}

	for name, body := range map[string][]byte{
		"not JSON":        []byte("not json"),
		"data not base64": []byte(`{"message":{"data":"%%%"}}`),
		"no app":          googleplaytest.PushBody(t, map[string]any{"testNotification": map[string]any{}}),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := googleplay.ParsePush(body); !errors.Is(err, googleplay.ErrMalformedNotification) {
				t.Fatalf("ParsePush = %v, want ErrMalformedNotification", err)
			}
		})
	}
}
