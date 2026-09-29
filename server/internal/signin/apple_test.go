package signin_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/publira/publira/server/internal/signin"
	"github.com/publira/publira/server/internal/signin/signintest"
)

type appleRequest struct {
	path string
	form url.Values
}

func newAppleServer(t *testing.T, status int, body string) (*signin.AppleClient, func() []appleRequest) {
	t.Helper()
	var mu sync.Mutex
	var requests []appleRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse the form: %v", err)
		}
		mu.Lock()
		requests = append(requests, appleRequest{path: r.URL.Path, form: r.PostForm})
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	client := signin.NewAppleClient(signin.AppleClientConfig{Endpoint: server.URL})
	return client, func() []appleRequest {
		mu.Lock()
		defer mu.Unlock()
		return append([]appleRequest(nil), requests...)
	}
}

func TestAppleClientExchangesACodeWithASignedClientSecret(t *testing.T) {
	keyPEM := signintest.PrivateKeyPEM(t)
	creds := signin.AppleCredentials{TeamID: "TEAM123456", KeyID: "KEY1234567", PrivateKey: keyPEM}
	client, requests := newAppleServer(t, http.StatusOK, `{"access_token":"a","refresh_token":"r-token","id_token":"i"}`)

	refreshToken, err := client.ExchangeCode(context.Background(), creds, servicesID, "the-code", "https://tenant.example.com/auth/apple/callback")
	if err != nil {
		t.Fatalf("ExchangeCode: %v", err)
	}
	if refreshToken != "r-token" {
		t.Fatalf("refresh token = %q, want r-token", refreshToken)
	}

	got := requests()
	if len(got) != 1 || got[0].path != "/auth/token" {
		t.Fatalf("requests = %+v, want one to /auth/token", got)
	}
	form := got[0].form
	for field, want := range map[string]string{
		"grant_type":   "authorization_code",
		"code":         "the-code",
		"client_id":    servicesID,
		"redirect_uri": "https://tenant.example.com/auth/apple/callback",
	} {
		if form.Get(field) != want {
			t.Fatalf("%s = %q, want %q", field, form.Get(field), want)
		}
	}

	key, err := signin.ParsePrivateKey(keyPEM)
	if err != nil {
		t.Fatalf("ParsePrivateKey: %v", err)
	}
	var claims jwt.RegisteredClaims
	secret, err := jwt.ParseWithClaims(form.Get("client_secret"), &claims, func(*jwt.Token) (any, error) {
		return &key.PublicKey, nil
	}, jwt.WithValidMethods([]string{"ES256"}))
	if err != nil {
		t.Fatalf("parse the client secret: %v", err)
	}
	if secret.Header["kid"] != "KEY1234567" || claims.Issuer != "TEAM123456" || claims.Subject != servicesID {
		t.Fatalf("client secret header = %v, claims = %+v", secret.Header, claims)
	}
	if len(claims.Audience) != 1 || claims.Audience[0] != signin.AppleIssuer {
		t.Fatalf("client secret audience = %v, want %s", claims.Audience, signin.AppleIssuer)
	}
	if lifetime := claims.ExpiresAt.Sub(claims.IssuedAt.Time); lifetime <= 0 || lifetime > time.Hour {
		t.Fatalf("client secret lifetime = %v", lifetime)
	}
}

func TestAppleClientRevokesARefreshToken(t *testing.T) {
	creds := signin.AppleCredentials{TeamID: "TEAM123456", KeyID: "KEY1234567", PrivateKey: signintest.PrivateKeyPEM(t)}
	client, requests := newAppleServer(t, http.StatusOK, ``)

	if err := client.RevokeRefreshToken(context.Background(), creds, "com.example.app", "r-token"); err != nil {
		t.Fatalf("RevokeRefreshToken: %v", err)
	}
	got := requests()
	if len(got) != 1 || got[0].path != "/auth/revoke" {
		t.Fatalf("requests = %+v, want one to /auth/revoke", got)
	}
	if got[0].form.Get("token") != "r-token" || got[0].form.Get("token_type_hint") != "refresh_token" || got[0].form.Get("client_id") != "com.example.app" {
		t.Fatalf("form = %v", got[0].form)
	}
}

func TestAppleClientTellsARefusedGrantFromARefusedClient(t *testing.T) {
	creds := signin.AppleCredentials{TeamID: "TEAM123456", KeyID: "KEY1234567", PrivateKey: signintest.PrivateKeyPEM(t)}
	for _, tc := range []struct {
		body string
		want error
	}{
		{body: `{"error":"invalid_grant"}`, want: signin.ErrInvalidGrant},
		{body: `{"error":"invalid_client"}`, want: signin.ErrInvalidClient},
	} {
		client, _ := newAppleServer(t, http.StatusBadRequest, tc.body)
		if _, err := client.ExchangeCode(context.Background(), creds, servicesID, "code", ""); !errors.Is(err, tc.want) {
			t.Fatalf("ExchangeCode with %s error = %v, want %v", tc.body, err, tc.want)
		}
	}
}
