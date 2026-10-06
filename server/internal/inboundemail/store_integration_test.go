package inboundemail_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/testutil"
)

// The table refuses what the store never writes, so a row written around it
// cannot hold a credential in plaintext or a domain no address matches.
func TestTableRefusesWhatTheStoreNeverWrites(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "INBTNT00000P", "inbound-plain.example.com", "Inbound Tenant")
	for name, row := range map[string]struct {
		enabled     bool
		domain      any
		credentials string
	}{
		"a plaintext credential":        {domain: "reply.example.com", credentials: `{"webhook_token": "plaintext"}`},
		"a credential that is not text": {domain: "reply.example.com", credentials: `{"webhook_token": 42}`},
		"credentials that are a list":   {domain: "reply.example.com", credentials: `["enc:v1:k1:abc"]`},
		"a domain in upper case":        {domain: "Reply.Example.com", credentials: `{}`},
		"an empty domain":               {domain: "", credentials: `{}`},
		"enabled on no domain":          {enabled: true, domain: nil, credentials: `{}`},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := pg.DB.ExecContext(ctx, `
				INSERT INTO tenant_inbound_email_config (tenant_id, provider, enabled, domain, credentials_encrypted)
				VALUES ($1, 'sendgrid', $2, $3, $4)
			`, tenant.ID, row.enabled, row.domain, row.credentials)
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
				t.Fatalf("insert error = %v, want check_violation", err)
			}
		})
	}
}
