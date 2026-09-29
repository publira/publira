package outbox_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/signin"
	"github.com/publira/publira/server/internal/signin/signintest"
	"github.com/publira/publira/server/internal/testutil"
)

const appleClientID = "com.example.reader.web"

type appleSignInFixture struct {
	pg        *testutil.PostgresEnv
	encryptor *secretcrypto.Manager
	tenantID  uuid.UUID
	tokens    *signintest.AppleTokens
}

func newAppleSignInFixture(t *testing.T) *appleSignInFixture {
	t.Helper()
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{4}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	tenant := pg.SeedTenant(t, "APPLESIGN001", "apple-sign-in.example.com", "Apple Sign In")
	if _, err := signin.NewSettings(dbmodels.New(pg.DB), encryptor).Update(context.Background(), tenant.ID, signin.UpdateInput{
		Apple: signin.AppleUpdate{
			Enabled:              true,
			ServicesID:           appleClientID,
			TeamID:               "TEAM123456",
			KeyID:                "KEY1234567",
			PrivateKey:           signintest.PrivateKeyPEM(t),
			PrivateKeyUpdateMode: secretupdate.Replace,
		},
	}); err != nil {
		t.Fatalf("save apple sign-in settings: %v", err)
	}
	return &appleSignInFixture{pg: pg, encryptor: encryptor, tenantID: tenant.ID, tokens: &signintest.AppleTokens{RefreshToken: "granted-token"}}
}

func (f *appleSignInFixture) handlerConfig(t *testing.T) outbox.AppleSignInHandlerConfig {
	return outbox.AppleSignInHandlerConfig{DB: f.pg.OpenOutboxDB(t), Encryptor: f.encryptor, Tokens: f.tokens}
}

func (f *appleSignInFixture) event(t *testing.T, eventType string, payload any) dbmodels.OutboxEvent {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  uuid.NullUUID{UUID: f.tenantID, Valid: true},
		EventType: eventType,
		Payload:   body,
	}
}

// A link that went while its code was exchanged leaves nothing to keep the
// token on, so the token the exchange granted is revoked there and then.
func TestAppleCodeExchangeRevokesWhatItGotForALinkThatIsGone(t *testing.T) {
	f := newAppleSignInFixture(t)
	sealed, err := signin.Seal(f.encryptor, "apple-code")
	if err != nil {
		t.Fatalf("seal the code: %v", err)
	}
	event := f.event(t, outbox.EventTypeAppleSignInCodeExchange, outbox.AppleSignInCodeExchangePayload{
		TenantID:      f.tenantID.String(),
		IdentityID:    uuid.NewString(),
		ClientID:      appleClientID,
		CodeEncrypted: sealed,
	})

	if err := outbox.NewAppleSignInCodeExchangeHandler(f.handlerConfig(t))(context.Background(), event); err != nil {
		t.Fatalf("handle: %v", err)
	}
	if got := f.tokens.Exchanges(); len(got) != 1 || got[0].Code != "apple-code" {
		t.Fatalf("exchanges = %+v", got)
	}
	if got := f.tokens.Revocations(); len(got) != 1 || got[0].RefreshToken != "granted-token" || got[0].ClientID != appleClientID {
		t.Fatalf("revocations = %+v, want the token the exchange granted", got)
	}
}

// A code Apple refuses cannot be exchanged by trying again.
func TestAppleCodeExchangeGivesUpOnARefusedCode(t *testing.T) {
	f := newAppleSignInFixture(t)
	f.tokens.ExchangeErr = signin.ErrInvalidGrant
	sealed, err := signin.Seal(f.encryptor, "expired-code")
	if err != nil {
		t.Fatalf("seal the code: %v", err)
	}
	event := f.event(t, outbox.EventTypeAppleSignInCodeExchange, outbox.AppleSignInCodeExchangePayload{
		TenantID:      f.tenantID.String(),
		IdentityID:    uuid.NewString(),
		ClientID:      appleClientID,
		CodeEncrypted: sealed,
	})

	err = outbox.NewAppleSignInCodeExchangeHandler(f.handlerConfig(t))(context.Background(), event)
	if !outbox.IsPermanent(err) || !errors.Is(err, signin.ErrInvalidGrant) {
		t.Fatalf("handle error = %v, want a permanent invalid grant", err)
	}
}

// A token Apple no longer knows is already in the state the revocation asks
// for.
func TestAppleTokenRevocationIsDoneForATokenAppleNoLongerKnows(t *testing.T) {
	f := newAppleSignInFixture(t)
	f.tokens.RevokeErr = signin.ErrInvalidGrant
	sealed, err := signin.Seal(f.encryptor, "stale-token")
	if err != nil {
		t.Fatalf("seal the token: %v", err)
	}
	event := f.event(t, outbox.EventTypeAppleSignInTokenRevoke, outbox.AppleSignInTokenRevokePayload{
		TenantID:              f.tenantID.String(),
		ClientID:              appleClientID,
		RefreshTokenEncrypted: sealed,
	})

	if err := outbox.NewAppleSignInTokenRevokeHandler(f.handlerConfig(t))(context.Background(), event); err != nil {
		t.Fatalf("handle: %v", err)
	}
	if got := f.tokens.Revocations(); len(got) != 1 || got[0].RefreshToken != "stale-token" {
		t.Fatalf("revocations = %+v", got)
	}
}
