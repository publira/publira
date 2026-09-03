package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
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

	t.Run("does not verify as an admin-media token", func(t *testing.T) {
		token, _, err := manager.IssueMediaToken("user-public-id", "tenant-id", "episode-id", 0, now)
		if err != nil {
			t.Fatalf("IssueMediaToken() error = %v", err)
		}
		if _, err := manager.Verify(token, AudienceAdminMedia); err == nil {
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

	// Verifiers skip the tenant check when the claim is absent, which is right
	// for a platform access token and wrong for a media URL: it would work
	// against every tenant.
	t.Run("refuses to issue a token that is not scoped to a tenant", func(t *testing.T) {
		if _, _, err := manager.IssueMediaToken("user-public-id", "  ", "episode-id", 0, now); err == nil {
			t.Fatal("IssueMediaToken() error = nil, want an error")
		}
	})
}

func TestIssueAdminMediaToken(t *testing.T) {
	manager := NewTokenManager([]byte(testSecret))
	now := time.Now()

	t.Run("carries the staff member, the tenant, and the one episode it previews", func(t *testing.T) {
		token, expiresAt, err := manager.IssueAdminMediaToken("user-public-id", "tenant-id", "episode-id", 3, now)
		if err != nil {
			t.Fatalf("IssueAdminMediaToken() error = %v", err)
		}
		if want := now.Add(MediaTokenTTL); !expiresAt.Equal(want) {
			t.Errorf("expiresAt = %v, want %v", expiresAt, want)
		}

		claims, err := manager.Verify(token, AudienceAdminMedia)
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

	t.Run("does not verify as a reader media token", func(t *testing.T) {
		token, _, err := manager.IssueAdminMediaToken("user-public-id", "tenant-id", "episode-id", 0, now)
		if err != nil {
			t.Fatalf("IssueAdminMediaToken() error = %v", err)
		}
		if _, err := manager.Verify(token, AudienceMedia); err == nil {
			t.Fatal("Verify() error = nil, want an audience error")
		}
	})

	t.Run("does not verify as an admin access token", func(t *testing.T) {
		token, _, err := manager.IssueAdminMediaToken("user-public-id", "tenant-id", "episode-id", 0, now)
		if err != nil {
			t.Fatalf("IssueAdminMediaToken() error = %v", err)
		}
		if _, err := manager.Verify(token, AudienceAdmin); err == nil {
			t.Fatal("Verify() error = nil, want an audience error")
		}
	})

	t.Run("an admin access token does not verify as an admin-media token", func(t *testing.T) {
		token, _, err := manager.Issue("user-public-id", AudienceAdmin, "tenant-id", RoleTenantEditor, 0, now)
		if err != nil {
			t.Fatalf("Issue() error = %v", err)
		}
		if _, err := manager.Verify(token, AudienceAdminMedia); err == nil {
			t.Fatal("Verify() error = nil, want an audience error")
		}
	})
}

func TestIssueFreeEpisodeMediaToken(t *testing.T) {
	manager := NewTokenManager([]byte(testSecret))
	now := time.Now()

	t.Run("carries the tenant and the one episode, and names no reader", func(t *testing.T) {
		token, expiresAt, err := manager.IssueFreeEpisodeMediaToken("tenant-id", "episode-id", now)
		if err != nil {
			t.Fatalf("IssueFreeEpisodeMediaToken() error = %v", err)
		}
		windowStart := now.UTC().Truncate(FreeEpisodeMediaTokenWindow)
		if want := windowStart.Add(FreeEpisodeMediaTokenTTL); !expiresAt.Equal(want) {
			t.Errorf("expiresAt = %v, want %v", expiresAt, want)
		}

		claims, err := manager.Verify(token, AudienceMedia)
		if err != nil {
			t.Fatalf("Verify() error = %v", err)
		}
		if claims.Subject != FreeEpisodeMediaSubject {
			t.Errorf("subject = %q, want %q", claims.Subject, FreeEpisodeMediaSubject)
		}
		if claims.TenantID != "tenant-id" {
			t.Errorf("tenant = %q, want %q", claims.TenantID, "tenant-id")
		}
		if claims.EpisodeID != "episode-id" {
			t.Errorf("episode = %q, want %q", claims.EpisodeID, "episode-id")
		}
		if claims.Role != "" {
			t.Errorf("role = %q, want no role", claims.Role)
		}
	})

	// A public_id is exactly publicid.Length characters of the Base58 alphabet,
	// which has neither punctuation nor that many of them to spare. Both halves
	// are asserted here because either one alone would let a future subject
	// drift into the space a real reader is looked up by.
	t.Run("the subject cannot be a user public_id", func(t *testing.T) {
		const publicIDLength = 12
		const base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
		if len(FreeEpisodeMediaSubject) <= publicIDLength {
			t.Errorf("subject %q is %d characters, want more than %d", FreeEpisodeMediaSubject, len(FreeEpisodeMediaSubject), publicIDLength)
		}
		if !strings.ContainsFunc(FreeEpisodeMediaSubject, func(r rune) bool {
			return !strings.ContainsRune(base58, r)
		}) {
			t.Errorf("subject %q is entirely Base58, want a character no public_id can hold", FreeEpisodeMediaSubject)
		}
	})

	// Every reader of one free episode has to be handed the identical URL, or
	// the shared caches in front of a free page stop being able to serve one
	// copy of it.
	t.Run("is identical for every reader within a rotation window", func(t *testing.T) {
		windowStart := now.UTC().Truncate(FreeEpisodeMediaTokenWindow)
		first, _, err := manager.IssueFreeEpisodeMediaToken("tenant-id", "episode-id", windowStart)
		if err != nil {
			t.Fatalf("IssueFreeEpisodeMediaToken() error = %v", err)
		}
		later, _, err := manager.IssueFreeEpisodeMediaToken(
			"tenant-id",
			"episode-id",
			windowStart.Add(FreeEpisodeMediaTokenWindow-time.Second),
		)
		if err != nil {
			t.Fatalf("IssueFreeEpisodeMediaToken() error = %v", err)
		}
		if first != later {
			t.Errorf("two issuances in one window differ:\n%s\n%s", first, later)
		}
	})

	t.Run("rotates with the window, and is scoped to one episode of one tenant", func(t *testing.T) {
		base, _, err := manager.IssueFreeEpisodeMediaToken("tenant-id", "episode-id", now)
		if err != nil {
			t.Fatalf("IssueFreeEpisodeMediaToken() error = %v", err)
		}
		for _, tc := range []struct {
			name      string
			tenantID  string
			episodeID string
			at        time.Time
		}{
			{name: "the next window", tenantID: "tenant-id", episodeID: "episode-id", at: now.Add(FreeEpisodeMediaTokenWindow)},
			{name: "another episode", tenantID: "tenant-id", episodeID: "other-episode-id", at: now},
			{name: "another tenant", tenantID: "other-tenant-id", episodeID: "episode-id", at: now},
		} {
			other, _, err := manager.IssueFreeEpisodeMediaToken(tc.tenantID, tc.episodeID, tc.at)
			if err != nil {
				t.Fatalf("IssueFreeEpisodeMediaToken() error = %v", err)
			}
			if other == base {
				t.Errorf("%s produced the same token", tc.name)
			}
		}
	})

	// The token a reader holds has to outlive the cached episode read that
	// handed it over, so what matters is the floor: even one issued at the very
	// end of a window still verifies a whole window later.
	t.Run("keeps a full window of life at the end of its own window", func(t *testing.T) {
		windowStart := now.UTC().Truncate(FreeEpisodeMediaTokenWindow)
		token, _, err := manager.IssueFreeEpisodeMediaToken("tenant-id", "episode-id", windowStart)
		if err != nil {
			t.Fatalf("IssueFreeEpisodeMediaToken() error = %v", err)
		}
		claims, err := manager.Verify(token, AudienceMedia)
		if err != nil {
			t.Fatalf("Verify() error = %v", err)
		}
		endOfWindow := windowStart.Add(FreeEpisodeMediaTokenWindow)
		if remaining := claims.ExpiresAt.Sub(endOfWindow); remaining < FreeEpisodeMediaTokenWindow {
			t.Errorf("remaining life at the end of the window = %v, want at least %v", remaining, FreeEpisodeMediaTokenWindow)
		}
	})

	t.Run("expires after FreeEpisodeMediaTokenTTL", func(t *testing.T) {
		token, _, err := manager.IssueFreeEpisodeMediaToken(
			"tenant-id",
			"episode-id",
			now.Add(-FreeEpisodeMediaTokenTTL-FreeEpisodeMediaTokenWindow),
		)
		if err != nil {
			t.Fatalf("IssueFreeEpisodeMediaToken() error = %v", err)
		}
		if _, err := manager.Verify(token, AudienceMedia); err == nil {
			t.Fatal("Verify() error = nil, want an expiry error")
		}
	})

	t.Run("does not verify as an API access token", func(t *testing.T) {
		token, _, err := manager.IssueFreeEpisodeMediaToken("tenant-id", "episode-id", now)
		if err != nil {
			t.Fatalf("IssueFreeEpisodeMediaToken() error = %v", err)
		}
		if _, err := manager.Verify(token, AudiencePublic); err == nil {
			t.Fatal("Verify() error = nil, want an audience error")
		}
	})

	t.Run("refuses to issue a token that is not scoped to an episode", func(t *testing.T) {
		if _, _, err := manager.IssueFreeEpisodeMediaToken("tenant-id", "  ", now); err == nil {
			t.Fatal("IssueFreeEpisodeMediaToken() error = nil, want an error")
		}
	})

	t.Run("refuses to issue a token that is not scoped to a tenant", func(t *testing.T) {
		if _, _, err := manager.IssueFreeEpisodeMediaToken("  ", "episode-id", now); err == nil {
			t.Fatal("IssueFreeEpisodeMediaToken() error = nil, want an error")
		}
	})
}

func TestWithMediaTokenQuery(t *testing.T) {
	if got := WithMediaTokenQuery("/images/episodes/x", ""); got != "/images/episodes/x" {
		t.Errorf("empty token = %q, want the original URL", got)
	}
	if got := WithMediaTokenQuery("/images/episodes/x", "tok"); got != "/images/episodes/x?t=tok" {
		t.Errorf("plain URL = %q, want query appended with ?", got)
	}
	if got := WithMediaTokenQuery("/images/episodes/x?w=16", "tok"); got != "/images/episodes/x?w=16&t=tok" {
		t.Errorf("existing query = %q, want token appended with &", got)
	}
	if got := WithMediaTokenQuery("/images/episodes/x#page", "tok"); got != "/images/episodes/x?t=tok#page" {
		t.Errorf("fragment URL = %q, want token before the fragment", got)
	}
	if got := WithMediaTokenQuery("/images/episodes/x?w=16#page", "tok"); got != "/images/episodes/x?w=16&t=tok#page" {
		t.Errorf("query and fragment = %q, want token in the query", got)
	}
}

func TestIssueMFAChallengeToken(t *testing.T) {
	manager := NewTokenManager([]byte(testSecret))
	// Verify checks exp against the wall clock, so the issue time has to be
	// anchored to it rather than to a fixed date.
	now := time.Now()

	// The jti is what a single-use challenge is recorded under, so two
	// challenges must never share one — including two minted for the same
	// account in the same instant.
	t.Run("gives every challenge an identifier of its own", func(t *testing.T) {
		first, expiresAt, err := manager.IssueMFAChallengeToken("user-public-id", AudienceAdminMFAVerify, "tenant-id", 3, now)
		if err != nil {
			t.Fatalf("IssueMFAChallengeToken() error = %v", err)
		}
		if want := now.Add(MFAChallengeTTL); !expiresAt.Equal(want) {
			t.Errorf("expiresAt = %v, want %v", expiresAt, want)
		}
		second, _, err := manager.IssueMFAChallengeToken("user-public-id", AudienceAdminMFAVerify, "tenant-id", 3, now)
		if err != nil {
			t.Fatalf("IssueMFAChallengeToken() error = %v", err)
		}

		firstClaims, err := manager.Verify(first, AudienceAdminMFAVerify)
		if err != nil {
			t.Fatalf("Verify() error = %v", err)
		}
		secondClaims, err := manager.Verify(second, AudienceAdminMFAVerify)
		if err != nil {
			t.Fatalf("Verify() error = %v", err)
		}
		// Both halves matter: an empty id would pass a bare inequality check
		// while leaving the challenge with nothing to be recorded under.
		for name, id := range map[string]string{"first": firstClaims.ID, "second": secondClaims.ID} {
			if _, err := uuid.Parse(id); err != nil {
				t.Errorf("%s challenge id = %q, want a uuid (%v)", name, id, err)
			}
		}
		if firstClaims.ID == secondClaims.ID {
			t.Errorf("both challenges carry id %q, want two different ones", firstClaims.ID)
		}
		if firstClaims.CredentialsVersion != 3 {
			t.Errorf("credentials version = %d, want 3", firstClaims.CredentialsVersion)
		}
	})

	// Nothing spends an access token, so it has no identifier to spend it by.
	t.Run("an access token carries no identifier", func(t *testing.T) {
		token, _, err := manager.Issue("user-public-id", AudienceAdmin, "tenant-id", RoleTenantAdmin, 0, now)
		if err != nil {
			t.Fatalf("Issue() error = %v", err)
		}
		claims, err := manager.Verify(token, AudienceAdmin)
		if err != nil {
			t.Fatalf("Verify() error = %v", err)
		}
		if claims.ID != "" {
			t.Errorf("access token id = %q, want empty", claims.ID)
		}
	})

	t.Run("refuses an audience that is not a challenge", func(t *testing.T) {
		if _, _, err := manager.IssueMFAChallengeToken("user-public-id", AudienceAdmin, "tenant-id", 0, now); err == nil {
			t.Fatal("IssueMFAChallengeToken() error = nil, want an audience error")
		}
	})
}
