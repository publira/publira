package main

import (
	"testing"

	"github.com/publira/publira/server/internal/mfachallenges"
)

func TestResolveMfaChallengePurgeChunkSize(t *testing.T) {
	t.Setenv("PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE", "")
	if got, err := resolveMfaChallengePurgeChunkSize(); err != nil || got != mfachallenges.DefaultChunkSize {
		t.Fatalf("default chunk size = (%d, %v), want (%d, nil)", got, err, mfachallenges.DefaultChunkSize)
	}

	t.Setenv("PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE", " 500 ")
	if got, err := resolveMfaChallengePurgeChunkSize(); err != nil || got != 500 {
		t.Fatalf("chunk size = (%d, %v), want (500, nil)", got, err)
	}

	t.Setenv("PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE", "0")
	if _, err := resolveMfaChallengePurgeChunkSize(); err == nil {
		t.Fatal("zero chunk size error = nil, want an error")
	}

	t.Setenv("PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE", "ten thousand")
	if _, err := resolveMfaChallengePurgeChunkSize(); err == nil {
		t.Fatal("non-numeric chunk size error = nil, want an error")
	}
}

func TestResolveMfaChallengePurgeDryRun(t *testing.T) {
	t.Setenv("PUBLIRA_MFA_CHALLENGE_PURGE_DRY_RUN", "")
	if got, err := resolveMfaChallengePurgeDryRun(); err != nil || got {
		t.Fatalf("default dry-run = (%t, %v), want (false, nil)", got, err)
	}

	t.Setenv("PUBLIRA_MFA_CHALLENGE_PURGE_DRY_RUN", " true ")
	if got, err := resolveMfaChallengePurgeDryRun(); err != nil || !got {
		t.Fatalf("dry-run = (%t, %v), want (true, nil)", got, err)
	}

	t.Setenv("PUBLIRA_MFA_CHALLENGE_PURGE_DRY_RUN", "maybe")
	if _, err := resolveMfaChallengePurgeDryRun(); err == nil {
		t.Fatal("invalid dry-run error = nil, want an error")
	}
}

func TestResolveMfaChallengeDBURL(t *testing.T) {
	t.Setenv("PUBLIRA_MFA_CHALLENGE_DB_URL", " mfa-challenge-url ")
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "content-stats-url")
	t.Setenv("PUBLIRA_WORKER_DB_URL", "worker-url")
	if got := resolveMfaChallengeDBURL("fallback-url"); got != "mfa-challenge-url" {
		t.Fatalf("mfa challenge URL = %q, want mfa-challenge-url", got)
	}

	t.Setenv("PUBLIRA_MFA_CHALLENGE_DB_URL", "")
	if got := resolveMfaChallengeDBURL("fallback-url"); got != "content-stats-url" {
		t.Fatalf("content stats URL = %q, want content-stats-url", got)
	}

	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "")
	if got := resolveMfaChallengeDBURL("fallback-url"); got != "worker-url" {
		t.Fatalf("worker URL = %q, want worker-url", got)
	}

	t.Setenv("PUBLIRA_WORKER_DB_URL", "")
	if got := resolveMfaChallengeDBURL("fallback-url"); got != "fallback-url" {
		t.Fatalf("fallback URL = %q, want fallback-url", got)
	}
}
