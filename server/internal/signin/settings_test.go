package signin_test

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/signin"
	"github.com/publira/publira/server/internal/signin/signintest"
)

// memoryQueries keeps one tenant's rows the way the upserts would.
type memoryQueries struct {
	config dbmodels.TenantConfig
	apple  *dbmodels.TenantAppleSignInConfig
	google *dbmodels.TenantGoogleSignInConfig
}

func (m *memoryQueries) GetTenantConfigByTenantID(context.Context, uuid.UUID) (dbmodels.TenantConfig, error) {
	return m.config, nil
}

func (m *memoryQueries) GetTenantAppleSignInConfig(context.Context, uuid.UUID) (dbmodels.TenantAppleSignInConfig, error) {
	if m.apple == nil {
		return dbmodels.TenantAppleSignInConfig{}, sql.ErrNoRows
	}
	return *m.apple, nil
}

func (m *memoryQueries) GetTenantGoogleSignInConfig(context.Context, uuid.UUID) (dbmodels.TenantGoogleSignInConfig, error) {
	if m.google == nil {
		return dbmodels.TenantGoogleSignInConfig{}, sql.ErrNoRows
	}
	return *m.google, nil
}

func (m *memoryQueries) UpsertTenantAppleSignInConfig(_ context.Context, arg dbmodels.UpsertTenantAppleSignInConfigParams) (dbmodels.TenantAppleSignInConfig, error) {
	m.apple = &dbmodels.TenantAppleSignInConfig{
		TenantID:            arg.TenantID,
		Enabled:             arg.Enabled,
		ServicesID:          arg.ServicesID,
		TeamID:              arg.TeamID,
		KeyID:               arg.KeyID,
		PrivateKeyEncrypted: arg.PrivateKeyEncrypted,
		PrivateKeyHint:      arg.PrivateKeyHint,
	}
	return *m.apple, nil
}

func (m *memoryQueries) UpsertTenantGoogleSignInConfig(_ context.Context, arg dbmodels.UpsertTenantGoogleSignInConfigParams) (dbmodels.TenantGoogleSignInConfig, error) {
	m.google = &dbmodels.TenantGoogleSignInConfig{
		TenantID:    arg.TenantID,
		Enabled:     arg.Enabled,
		WebClientID: arg.WebClientID,
		IosClientID: arg.IosClientID,
	}
	return *m.google, nil
}

func newManager(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	manager, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return manager
}

func TestSettingsStoreTheAppleKeySealedAndAnswerOnlyItsHint(t *testing.T) {
	queries := &memoryQueries{config: dbmodels.TenantConfig{IosBundleIdentifier: sql.NullString{String: "com.example.app", Valid: true}}}
	settings := signin.NewSettings(queries, newManager(t))
	tenantID := uuid.Must(uuid.NewV7())
	keyPEM := signintest.PrivateKeyPEM(t)

	cfg, err := settings.Update(context.Background(), tenantID, signin.UpdateInput{
		Apple: signin.AppleUpdate{
			Enabled:              true,
			ServicesID:           servicesID,
			TeamID:               "team123456",
			KeyID:                "key1234567",
			PrivateKey:           keyPEM,
			PrivateKeyUpdateMode: secretupdate.Replace,
		},
		Google: signin.GoogleUpdate{Enabled: true, WebClientID: webClientID},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if !cfg.Apple.Ready || cfg.Apple.TeamID != "TEAM123456" || cfg.Apple.KeyID != "KEY1234567" || !cfg.Apple.PrivateKeyConfigured {
		t.Fatalf("apple = %+v", cfg.Apple)
	}
	if strings.Contains(cfg.Apple.PrivateKeyHint, "PRIVATE KEY") || !strings.Contains(cfg.Apple.PrivateKeyHint, "•") {
		t.Fatalf("hint = %q, want a masked key", cfg.Apple.PrivateKeyHint)
	}
	if got := cfg.Apple.Audiences(); len(got) != 2 || got[0] != servicesID || got[1] != "com.example.app" {
		t.Fatalf("apple audiences = %v", got)
	}
	if !secretcrypto.IsEncryptedEnvelope(queries.apple.PrivateKeyEncrypted.String) {
		t.Fatalf("stored key = %q, want an envelope", queries.apple.PrivateKeyEncrypted.String)
	}
	if !cfg.Google.Ready || len(cfg.Google.Audiences()) != 1 {
		t.Fatalf("google = %+v", cfg.Google)
	}

	creds, err := settings.LoadAppleCredentials(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("LoadAppleCredentials: %v", err)
	}
	if creds.PrivateKey != strings.TrimSpace(keyPEM) || creds.TeamID != "TEAM123456" || creds.KeyID != "KEY1234567" {
		t.Fatalf("credentials = %+v", creds)
	}

	// A request that says nothing about the key keeps it.
	kept, err := settings.Update(context.Background(), tenantID, signin.UpdateInput{
		Apple: signin.AppleUpdate{Enabled: true, ServicesID: servicesID, TeamID: "TEAM123456", KeyID: "KEY1234567"},
	})
	if err != nil {
		t.Fatalf("Update keeping the key: %v", err)
	}
	if kept.Apple.PrivateKeyHint != cfg.Apple.PrivateKeyHint || kept.Google.Enabled {
		t.Fatalf("kept = %+v", kept)
	}
}

func TestSettingsRefuseWhatCannotSignIn(t *testing.T) {
	keyPEM := signintest.PrivateKeyPEM(t)
	for _, tc := range []struct {
		name  string
		input signin.UpdateInput
		want  error
	}{
		{
			name:  "apple enabled without a key",
			input: signin.UpdateInput{Apple: signin.AppleUpdate{Enabled: true, ServicesID: servicesID, TeamID: "TEAM123456", KeyID: "KEY1234567"}},
			want:  signin.ErrAppleCredentialsRequired,
		},
		{
			name:  "a key that is not a P-256 PKCS #8 key",
			input: signin.UpdateInput{Apple: signin.AppleUpdate{PrivateKey: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----", PrivateKeyUpdateMode: secretupdate.Replace}},
			want:  signin.ErrInvalidPrivateKey,
		},
		{
			name:  "a malformed team ID",
			input: signin.UpdateInput{Apple: signin.AppleUpdate{TeamID: "TEAM", PrivateKey: keyPEM, PrivateKeyUpdateMode: secretupdate.Replace}},
			want:  signin.ErrInvalidTeamID,
		},
		{
			name:  "a malformed services ID",
			input: signin.UpdateInput{Apple: signin.AppleUpdate{ServicesID: "no-dots"}},
			want:  signin.ErrInvalidServicesID,
		},
		{
			name:  "google enabled without a client",
			input: signin.UpdateInput{Google: signin.GoogleUpdate{Enabled: true}},
			want:  signin.ErrGoogleClientRequired,
		},
		{
			name:  "a client ID of something other than Google",
			input: signin.UpdateInput{Google: signin.GoogleUpdate{WebClientID: "client.example.com"}},
			want:  signin.ErrInvalidGoogleClientID,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings := signin.NewSettings(&memoryQueries{}, newManager(t))
			if _, err := settings.Update(context.Background(), uuid.Must(uuid.NewV7()), tc.input); !errors.Is(err, tc.want) {
				t.Fatalf("Update error = %v, want %v", err, tc.want)
			}
		})
	}
}

// Apple is ready only where a client can sign in with it: the storefront's
// Services ID, or the iOS app the tenant's association names.
func TestAppleIsReadyOnlyWithAClientToSignInWith(t *testing.T) {
	queries := &memoryQueries{}
	settings := signin.NewSettings(queries, newManager(t))
	cfg, err := settings.Update(context.Background(), uuid.Must(uuid.NewV7()), signin.UpdateInput{
		Apple: signin.AppleUpdate{Enabled: true, TeamID: "TEAM123456", KeyID: "KEY1234567", PrivateKey: signintest.PrivateKeyPEM(t), PrivateKeyUpdateMode: secretupdate.Replace},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if cfg.Apple.Ready {
		t.Fatalf("apple ready without a services ID or an iOS app, want not ready: %+v", cfg.Apple)
	}
}
