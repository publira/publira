package signin_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/signin"
	"github.com/publira/publira/server/internal/signin/signintest"
)

const (
	webClientID = "123-web.apps.googleusercontent.com"
	iosClientID = "123-ios.apps.googleusercontent.com"
	servicesID  = "com.example.web"
	nonce       = "a-fresh-nonce"
)

func TestVerifyAcceptsATokenIssuedToOneOfTheTenantsClients(t *testing.T) {
	apple, google := signintest.NewProvider(t), signintest.NewProvider(t)
	verifier := signintest.Verifier(apple, google)
	raw := google.Sign(t, signintest.Token{
		Issuer:   signin.GoogleIssuer,
		Subject:  "google-subject",
		Audience: iosClientID,
		Email:    "reader@example.com",
		Name:     "Reader",
		Nonce:    nonce,
	})

	claims, err := verifier.Verify(context.Background(), signin.ProviderGoogle, raw, []string{webClientID, iosClientID}, nonce)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.Subject != "google-subject" || claims.Audience != iosClientID || claims.Email != "reader@example.com" || !claims.EmailVerified || claims.Name != "Reader" {
		t.Fatalf("claims = %+v", claims)
	}
}

// Apple writes email_verified as a string, and an iOS app hands Apple the
// SHA-256 of its nonce rather than the nonce.
func TestVerifyReadsApplesStringClaimAndHashedNonce(t *testing.T) {
	apple, google := signintest.NewProvider(t), signintest.NewProvider(t)
	verifier := signintest.Verifier(apple, google)

	for _, tc := range []struct {
		name          string
		emailVerified string
		want          bool
	}{
		{name: "true", emailVerified: "true", want: true},
		{name: "false", emailVerified: "false", want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := apple.Sign(t, signintest.Token{
				Issuer:        signin.AppleIssuer,
				Subject:       "apple-subject",
				Audience:      servicesID,
				Email:         "relay@privaterelay.appleid.com",
				EmailVerified: tc.emailVerified,
				Nonce:         signin.HashNonce(nonce),
			})
			claims, err := verifier.Verify(context.Background(), signin.ProviderApple, raw, []string{servicesID}, nonce)
			if err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if claims.EmailVerified != tc.want {
				t.Fatalf("email_verified = %v, want %v", claims.EmailVerified, tc.want)
			}
		})
	}
}

func TestVerifyRefusesATokenThatIsNotForThisSignIn(t *testing.T) {
	apple, google := signintest.NewProvider(t), signintest.NewProvider(t)
	verifier := signintest.Verifier(apple, google)
	valid := signintest.Token{Issuer: signin.GoogleIssuer, Subject: "google-subject", Audience: webClientID, Email: "reader@example.com", Nonce: nonce}

	for _, tc := range []struct {
		name     string
		provider string
		signer   *signintest.Provider
		change   func(*signintest.Token)
		nonce    string
	}{
		{name: "another client's token", signer: google, change: func(tok *signintest.Token) { tok.Audience = "999-other.apps.googleusercontent.com" }},
		{name: "another issuer", signer: google, change: func(tok *signintest.Token) { tok.Issuer = "https://evil.example.com" }},
		{name: "expired", signer: google, change: func(tok *signintest.Token) { tok.ExpiresAt = time.Now().Add(-time.Hour) }},
		{name: "another nonce", signer: google, change: func(*signintest.Token) {}, nonce: "another-nonce"},
		{name: "no nonce", signer: google, change: func(tok *signintest.Token) { tok.Nonce = "" }},
		{name: "no subject", signer: google, change: func(tok *signintest.Token) { tok.Subject = "" }},
		{name: "signed by another key", signer: apple, change: func(*signintest.Token) {}},
		{name: "a google token handed in as apple's", provider: signin.ProviderApple, signer: google, change: func(*signintest.Token) {}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token := valid
			tc.change(&token)
			provider := tc.provider
			if provider == "" {
				provider = signin.ProviderGoogle
			}
			given := tc.nonce
			if given == "" {
				given = nonce
			}
			_, err := verifier.Verify(context.Background(), provider, tc.signer.Sign(t, token), []string{webClientID}, given)
			if !errors.Is(err, signin.ErrInvalidToken) {
				t.Fatalf("Verify error = %v, want ErrInvalidToken", err)
			}
		})
	}
}

func TestVerifyReportsAKeySetItCannotRead(t *testing.T) {
	google := signintest.NewProvider(t)
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(down.Close)
	verifier := signin.NewVerifier(signin.VerifierConfig{GoogleKeysURL: down.URL})
	raw := google.Sign(t, signintest.Token{Issuer: signin.GoogleIssuer, Subject: "s", Audience: webClientID, Nonce: nonce})

	_, err := verifier.Verify(context.Background(), signin.ProviderGoogle, raw, []string{webClientID}, nonce)
	if !errors.Is(err, signin.ErrKeysUnavailable) {
		t.Fatalf("Verify error = %v, want ErrKeysUnavailable", err)
	}
}

// Tokens naming a key the set does not hold refetch the set at most once a
// minute, so forged key IDs cannot turn into a stream of requests.
func TestVerifyBoundsTheRefetchesAnUnknownKeyCauses(t *testing.T) {
	google := signintest.NewProvider(t)
	var fetches atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetches.Add(1)
		resp, err := http.Get(google.KeysURL())
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		defer resp.Body.Close() //nolint:errcheck
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.Copy(w, resp.Body)
	}))
	t.Cleanup(proxy.Close)
	verifier := signin.NewVerifier(signin.VerifierConfig{GoogleKeysURL: proxy.URL})
	token := signintest.Token{Issuer: signin.GoogleIssuer, Subject: "s", Audience: webClientID, Nonce: nonce}
	if _, err := verifier.Verify(context.Background(), signin.ProviderGoogle, google.Sign(t, token), []string{webClientID}, nonce); err != nil {
		t.Fatalf("Verify: %v", err)
	}

	token.KeyID = "unpublished-key"
	forged := google.Sign(t, token)
	for range 5 {
		if _, err := verifier.Verify(context.Background(), signin.ProviderGoogle, forged, []string{webClientID}, nonce); !errors.Is(err, signin.ErrInvalidToken) {
			t.Fatalf("Verify forged error = %v, want ErrInvalidToken", err)
		}
	}
	if got := fetches.Load(); got != 1 {
		t.Fatalf("key set fetches = %d, want 1", got)
	}
}

func TestVerifierConfigFromEnvReadsTheKeySetURLs(t *testing.T) {
	t.Run("unset keeps the providers' key sets", func(t *testing.T) {
		t.Setenv("PUBLIRA_SIGN_IN_APPLE_KEYS_URL", "")
		t.Setenv("PUBLIRA_SIGN_IN_GOOGLE_KEYS_URL", "")
		cfg, err := signin.VerifierConfigFromEnv()
		if err != nil {
			t.Fatalf("VerifierConfigFromEnv: %v", err)
		}
		if cfg.AppleKeysURL != "" || cfg.GoogleKeysURL != "" {
			t.Fatalf("cfg = %+v", cfg)
		}
	})

	t.Run("set replaces them", func(t *testing.T) {
		t.Setenv("PUBLIRA_SIGN_IN_APPLE_KEYS_URL", "http://127.0.0.1:8400/keys")
		t.Setenv("PUBLIRA_SIGN_IN_GOOGLE_KEYS_URL", " https://keys.example/google ")
		cfg, err := signin.VerifierConfigFromEnv()
		if err != nil {
			t.Fatalf("VerifierConfigFromEnv: %v", err)
		}
		if cfg.AppleKeysURL != "http://127.0.0.1:8400/keys" || cfg.GoogleKeysURL != "https://keys.example/google" {
			t.Fatalf("cfg = %+v", cfg)
		}
	})

	for _, value := range []string{"keys.example/google", "file:///tmp/keys.json", "http://"} {
		t.Run("refuses "+value, func(t *testing.T) {
			t.Setenv("PUBLIRA_SIGN_IN_APPLE_KEYS_URL", "")
			t.Setenv("PUBLIRA_SIGN_IN_GOOGLE_KEYS_URL", value)
			if _, err := signin.VerifierConfigFromEnv(); err == nil {
				t.Fatal("VerifierConfigFromEnv accepted the URL")
			}
		})
	}
}
