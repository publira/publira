package auth

import (
	"strings"
	"testing"
	"time"
)

const testSecret = "publira-unit-test-auth-jwt-secret-32b!"

func TestNewTokenManagerFromEnv(t *testing.T) {
	t.Run("returns a manager for a configured secret", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", testSecret)

		manager, err := NewTokenManagerFromEnv()
		if err != nil {
			t.Fatalf("NewTokenManagerFromEnv() error = %v", err)
		}
		if string(manager.secret) != testSecret {
			t.Errorf("secret = %q, want %q", manager.secret, testSecret)
		}
	})

	t.Run("trims surrounding whitespace", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", "  "+testSecret+"\n")

		manager, err := NewTokenManagerFromEnv()
		if err != nil {
			t.Fatalf("NewTokenManagerFromEnv() error = %v", err)
		}
		if string(manager.secret) != testSecret {
			t.Errorf("secret = %q, want %q", manager.secret, testSecret)
		}
	})

	// The three cases below used to yield a signing key committed to this
	// repository, which let anyone forge an access token.
	t.Run("fails when the variable is unset", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", "")

		if _, err := NewTokenManagerFromEnv(); err == nil {
			t.Fatal("NewTokenManagerFromEnv() error = nil, want an error")
		}
	})

	t.Run("fails when the value is only whitespace", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", "   ")

		if _, err := NewTokenManagerFromEnv(); err == nil {
			t.Fatal("NewTokenManagerFromEnv() error = nil, want an error")
		}
	})

	t.Run("fails when the value is shorter than the minimum", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", strings.Repeat("a", MinJWTSecretBytes-1))

		_, err := NewTokenManagerFromEnv()
		if err == nil {
			t.Fatal("NewTokenManagerFromEnv() error = nil, want an error")
		}
		if !strings.Contains(err.Error(), "at least 32 bytes") {
			t.Errorf("error = %q, want it to name the minimum length", err)
		}
	})

	t.Run("measures the length in bytes, not runes", func(t *testing.T) {
		// 12 runes, 36 UTF-8 bytes.
		const multibyte = "あいうえおかきくけこさし"
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", multibyte)

		manager, err := NewTokenManagerFromEnv()
		if err != nil {
			t.Fatalf("NewTokenManagerFromEnv() error = %v", err)
		}
		if string(manager.secret) != multibyte {
			t.Errorf("secret = %q, want %q", manager.secret, multibyte)
		}
	})
}

func TestIssueMediaToken(t *testing.T) {
	manager := NewTokenManager([]byte(testSecret))
	// Verify checks exp against the wall clock, so the issue time has to be
	// anchored to it rather than to a fixed date.
	now := time.Now()

	t.Run("carries the reader, the tenant, and the one episode it unlocks", func(t *testing.T) {
		token, expiresAt, err := manager.IssueMediaToken("user-public-id", "tenant-id", "episode-id", 3, now)
		if err != nil {
			t.Fatalf("IssueMediaToken() error = %v", err)
		}
		if want := now.Add(MediaTokenTTL); !expiresAt.Equal(want) {
			t.Errorf("expiresAt = %v, want %v", expiresAt, want)
		}

		claims, err := manager.Verify(token, AudienceMedia)
		if err != nil {
			t.Fatalf("Verify() error = %v", err)
		}
		if claims.Subject != "user-public-id" {
			t.Errorf("subject = %q, want %q", claims.Subject, "user-public-id")
		}
		if claims.TenantID != "tenant-id" {
			t.Errorf("tenant = %q, want %q", claims.TenantID, "tenant-id")
		}
		if claims.EpisodeID != "episode-id" {
			t.Errorf("episode = %q, want %q", claims.EpisodeID, "episode-id")
		}
		if claims.CredentialsVersion != 3 {
			t.Errorf("credentials version = %d, want 3", claims.CredentialsVersion)
		}
	})

	// The separate audiences are what keep a URL-borne token from reaching the
	// API, and an API access token from being pasted into an image URL.
	t.Run("does not verify as a public access token", func(t *testing.T) {
		token, _, err := manager.IssueMediaToken("user-public-id", "tenant-id", "episode-id", 0, now)
		if err != nil {
			t.Fatalf("IssueMediaToken() error = %v", err)
		}
		if _, err := manager.Verify(token, AudiencePublic); err == nil {
			t.Fatal("Verify() error = nil, want an audience error")
		}
	})

	t.Run("an access token does not verify as a media token", func(t *testing.T) {
		token, _, err := manager.Issue("user-public-id", AudiencePublic, "tenant-id", "", 0, now)
		if err != nil {
			t.Fatalf("Issue() error = %v", err)
		}
		if _, err := manager.Verify(token, AudienceMedia); err == nil {
			t.Fatal("Verify() error = nil, want an audience error")
		}
	})

	t.Run("expires after MediaTokenTTL", func(t *testing.T) {
		issuedAt := now.Add(-MediaTokenTTL - time.Minute)
		token, _, err := manager.IssueMediaToken("user-public-id", "tenant-id", "episode-id", 0, issuedAt)
		if err != nil {
			t.Fatalf("IssueMediaToken() error = %v", err)
		}
		if _, err := manager.Verify(token, AudienceMedia); err == nil {
			t.Fatal("Verify() error = nil, want an expiry error")
		}
	})

	t.Run("refuses to issue a token that is not scoped to an episode", func(t *testing.T) {
		if _, _, err := manager.IssueMediaToken("user-public-id", "tenant-id", "  ", 0, now); err == nil {
			t.Fatal("IssueMediaToken() error = nil, want an error")
		}
	})
}
