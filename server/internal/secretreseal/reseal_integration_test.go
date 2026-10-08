package secretreseal_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretreseal"
	"github.com/publira/publira/server/internal/testutil"
)

// manager holds the keys keyIDs name. A key's material follows from its ID,
// so k1 is the same key in every manager that holds it.
func manager(t *testing.T, primary string, keyIDs ...string) *secretcrypto.Manager {
	t.Helper()
	keys := map[string][]byte{}
	for _, id := range keyIDs {
		keys[id] = bytes.Repeat([]byte{id[len(id)-1]}, 32)
	}
	mgr, err := secretcrypto.NewManager(keys, primary)
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return mgr
}

func seal(t *testing.T, mgr *secretcrypto.Manager, plaintext string) string {
	t.Helper()
	sealed, err := mgr.EncryptString(plaintext)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	return sealed
}

func sealedJSON(t *testing.T, fields map[string]any) string {
	t.Helper()
	raw, err := json.Marshal(fields)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	return string(raw)
}

func exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

// seedEveryColumn stores a value sealed with sealer in every column that holds
// one, the way each save path stores it.
func seedEveryColumn(t *testing.T, pg *testutil.PostgresEnv, sealer *secretcrypto.Manager) {
	t.Helper()
	db := pg.DB
	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMIN0000001", "admin@example.com", "Admin")
	reader := pg.SeedEndUser(t, tenant.ID, "READER000001", "reader@example.com", "Reader")

	exec(t, db, `INSERT INTO platform_smtp_config (host, port, username, password_encrypted, encryption, from_address)
		VALUES ('smtp.example.com', 587, 'mailer', $1, 'starttls', 'noreply@example.com')`, seal(t, sealer, "smtp-password"))
	exec(t, db, `INSERT INTO platform_storage_config (bucket, region, access_key_id, secret_access_key_encrypted)
		VALUES ('publira', 'auto', 'access-key', $1)`, seal(t, sealer, "storage-secret"))
	exec(t, db, `INSERT INTO platform_search_config (engine, url, index_alias, username, password_encrypted,
			serving_engine, serving_url, serving_index_alias, serving_username, serving_password_encrypted)
		VALUES ('opensearch', 'https://search.example.com', 'catalog', 'search', $1,
			'opensearch', 'https://search.example.com', 'catalog', 'search', $2)`,
		seal(t, sealer, "search-password"), seal(t, sealer, "search-password"))
	exec(t, db, `INSERT INTO platform_webpush_config (vapid_public_key, vapid_private_key_encrypted)
		VALUES ('public-key', $1)`, seal(t, sealer, "vapid-private-key"))

	exec(t, db, `INSERT INTO tenant_smtp_config (tenant_id, password_encrypted) VALUES ($1, $2)`,
		tenant.ID, seal(t, sealer, "tenant-smtp-password"))
	exec(t, db, `INSERT INTO tenant_payment_config (tenant_id, provider, credentials_encrypted, credential_hints)
		VALUES ($1, 'stripe', $2, '{"secret_key": "sk_…1234"}')`, tenant.ID, sealedJSON(t, map[string]any{
		"secret_key":     seal(t, sealer, "sk_test_1234"),
		"webhook_secret": seal(t, sealer, "whsec_1234"),
	}))
	exec(t, db, `INSERT INTO tenant_inbound_email_config (tenant_id, provider, credentials_encrypted)
		VALUES ($1, 'postmark', $2)`, tenant.ID, sealedJSON(t, map[string]any{
		"webhook_password": seal(t, sealer, "inbound-password"),
	}))
	exec(t, db, `INSERT INTO tenant_app_store_config (tenant_id, private_key_encrypted) VALUES ($1, $2)`,
		tenant.ID, seal(t, sealer, "app-store-key"))
	exec(t, db, `INSERT INTO tenant_google_play_config (tenant_id, service_account_email, service_account_key_encrypted)
		VALUES ($1, 'play@example.iam.gserviceaccount.com', $2)`, tenant.ID, seal(t, sealer, "play-key"))
	exec(t, db, `INSERT INTO tenant_apple_sign_in_config (tenant_id, private_key_encrypted) VALUES ($1, $2)`,
		tenant.ID, seal(t, sealer, "apple-key"))
	exec(t, db, `INSERT INTO tenant_fcm_config (tenant_id, project_id, client_email, service_account_json_encrypted)
		VALUES ($1, 'project', 'fcm@example.iam.gserviceaccount.com', $2)`, tenant.ID, seal(t, sealer, `{"type":"service_account"}`))

	exec(t, db, `INSERT INTO user_mfa_totp (user_id, tenant_id, secret_encrypted) VALUES ($1, $2, $3)`,
		admin.ID, tenant.ID, seal(t, sealer, "TOTPSECRET"))
	exec(t, db, `INSERT INTO user_identities (id, tenant_id, user_id, provider, subject, email_at_link,
			refresh_token_encrypted, refresh_token_client_id)
		VALUES ($1, $2, $3, 'apple', 'apple-subject', 'reader@example.com', $4, 'com.example.web')`,
		uuid.New(), tenant.ID, reader.ID, seal(t, sealer, "apple-refresh-token"))

	// A revocation the worker has not sent yet carries the token of a link
	// that is gone, and one it has sent still holds it.
	for _, status := range []string{"pending", "done"} {
		exec(t, db, `INSERT INTO outbox_events (id, tenant_id, event_type, idempotency_key, status, payload)
			VALUES ($1, $2, 'apple_sign_in_token_revoke', $3, $4, $5)`,
			uuid.New(), tenant.ID, "revoke:"+status, status, sealedJSON(t, map[string]any{
				"tenant_id":               tenant.ID.String(),
				"client_id":               "com.example.web",
				"refresh_token_encrypted": seal(t, sealer, "revoked-token-"+status),
			}))
	}
	// An event that carries no secret is left as it is, even where what a
	// tenant wrote in it looks like an envelope or is a copy of one.
	exec(t, db, `INSERT INTO outbox_events (id, event_type, idempotency_key, payload)
		VALUES ($1, 'announcement_notification', 'plain', $2)`, uuid.New(), sealedJSON(t, map[string]any{
		"subject": "<b>Hello</b>",
		"title":   "enc:v1:not-a-real-envelope",
		"body":    seal(t, sealer, "copied into an announcement"),
	}))
}

// sealedValues is every envelope a column holds, keyed by the row and the path
// to it inside a document.
func sealedValues(t *testing.T, db *sql.DB, c secretreseal.Column) map[string]string {
	t.Helper()
	rows, err := db.QueryContext(context.Background(), fmt.Sprintf(
		`SELECT %[2]s::text, %[1]s::text FROM %[3]s WHERE %[1]s IS NOT NULL`,
		pgx.Identifier{c.Name}.Sanitize(), pgx.Identifier{c.Key}.Sanitize(), pgx.Identifier{c.Table}.Sanitize()))
	if err != nil {
		t.Fatalf("read %s: %v", c, err)
	}
	defer rows.Close() //nolint:errcheck
	values := map[string]string{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			t.Fatalf("read %s: %v", c, err)
		}
		if c.Type != "jsonb" {
			if secretcrypto.IsEncryptedEnvelope(value) {
				values[key] = value
			}
			continue
		}
		var doc any
		if err := json.Unmarshal([]byte(value), &doc); err != nil {
			t.Fatalf("decode %s of %s: %v", c, key, err)
		}
		collectEnvelopes(doc, key, strings.HasSuffix(c.Name, "_encrypted"), values)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read %s: %v", c, err)
	}
	return values
}

// collectEnvelopes collects the envelopes of a document that are sealed
// values: every one in a column named *_encrypted, and elsewhere only those
// under a member named that way.
func collectEnvelopes(node any, path string, sealed bool, into map[string]string) {
	switch v := node.(type) {
	case string:
		if sealed && secretcrypto.IsEncryptedEnvelope(v) {
			into[path] = v
		}
	case map[string]any:
		for k, child := range v {
			collectEnvelopes(child, path+"."+k, sealed || strings.HasSuffix(k, "_encrypted"), into)
		}
	case []any:
		for i, child := range v {
			collectEnvelopes(child, fmt.Sprintf("%s[%d]", path, i), sealed, into)
		}
	}
}

// snapshot is every envelope in every column, keyed by column, row, and path.
func snapshot(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	columns, err := secretreseal.SealedColumns(context.Background(), db)
	if err != nil {
		t.Fatalf("SealedColumns: %v", err)
	}
	all := map[string]string{}
	for _, c := range columns {
		for k, v := range sealedValues(t, db, c) {
			all[c.String()+" "+k] = v
		}
	}
	return all
}

func open(t *testing.T, mgr *secretcrypto.Manager, values map[string]string) map[string]string {
	t.Helper()
	plaintexts := make(map[string]string, len(values))
	for k, v := range values {
		p, err := mgr.DecryptString(v)
		if err != nil {
			t.Fatalf("open %s: %v", k, err)
		}
		plaintexts[k] = p
	}
	return plaintexts
}

func countByKey(values map[string]string) map[string]int {
	counts := map[string]int{}
	for _, v := range values {
		id, _ := secretcrypto.EnvelopeKeyID(v)
		counts[id]++
	}
	return counts
}

// After a run with the old key and the new, every value opens with the new
// key alone, to the plaintext it held before, and nothing names the old key.
func TestRunResealsEveryStoredSecretWithThePrimaryKey(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()
	old := manager(t, "k1", "k1")
	rotated := manager(t, "k2", "k1", "k2")
	retired := manager(t, "k2", "k2")

	seedEveryColumn(t, pg, old)
	// One value saved again since k2 became the primary key.
	staff := pg.SeedTenantAdmin(t, mustTenantID(t, pg.DB), "ADMIN0000002", "second@example.com", "Second")
	exec(t, pg.DB, `INSERT INTO user_mfa_totp (user_id, tenant_id, secret_encrypted) VALUES ($1, $2, $3)`,
		staff.ID, staff.TenantID, seal(t, rotated, "SECONDSECRET"))

	columns, err := secretreseal.SealedColumns(ctx, pg.DB)
	if err != nil {
		t.Fatalf("SealedColumns: %v", err)
	}
	for _, c := range columns {
		if countByKey(sealedValues(t, pg.DB, c))["k1"] == 0 {
			t.Fatalf("%s holds no value sealed with k1: seed one in seedEveryColumn, or the run is not shown to reach it", c)
		}
	}
	before := snapshot(t, pg.DB)
	plaintexts := open(t, rotated, before)
	plainEvent := outboxPayload(t, pg.DB, "plain")

	// A batch of two makes every column with more rows than that page.
	report, err := secretreseal.Run(ctx, pg.DB, rotated, secretreseal.Options{BatchSize: 2})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	k1 := countByKey(before)["k1"]
	want := map[string]secretreseal.Counts{"k1": {Resealed: k1}, "k2": {Current: 1}}
	if !maps.Equal(report.Keys, want) {
		t.Fatalf("report = %+v, want %+v", report.Keys, want)
	}

	after := snapshot(t, pg.DB)
	if got := countByKey(after); !maps.Equal(got, map[string]int{"k2": len(before)}) {
		t.Fatalf("values by key after the run = %v, want all %d on k2", got, len(before))
	}
	if got := open(t, retired, after); !maps.Equal(got, plaintexts) {
		t.Fatalf("plaintexts after the run = %v, want %v", got, plaintexts)
	}
	if got := outboxPayload(t, pg.DB, "plain"); got != plainEvent {
		t.Fatalf("an event that carries no secret = %s, want it left as %s", got, plainEvent)
	}
	var clientID string
	if err := pg.DB.QueryRowContext(ctx,
		`SELECT payload->>'client_id' FROM outbox_events WHERE idempotency_key = 'revoke:pending'`,
	).Scan(&clientID); err != nil || clientID != "com.example.web" {
		t.Fatalf("the revocation's client_id = %q, %v; want it kept", clientID, err)
	}

	// A second run finds nothing left to move.
	report, err = secretreseal.Run(ctx, pg.DB, retired, secretreseal.Options{})
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if want := map[string]secretreseal.Counts{"k2": {Current: len(before)}}; !maps.Equal(report.Keys, want) {
		t.Fatalf("second report = %+v, want %+v", report.Keys, want)
	}
}

func TestRunDryRunWritesNothing(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	seedEveryColumn(t, pg, manager(t, "k1", "k1"))
	before := snapshot(t, pg.DB)

	report, err := secretreseal.Run(context.Background(), pg.DB, manager(t, "k2", "k1", "k2"), secretreseal.Options{DryRun: true})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := map[string]secretreseal.Counts{"k1": {Resealed: len(before)}}; !maps.Equal(report.Keys, want) {
		t.Fatalf("report = %+v, want %+v", report.Keys, want)
	}
	if after := snapshot(t, pg.DB); !maps.Equal(after, before) {
		t.Fatal("a dry run changed a stored value")
	}
}

// A value no configured key opens is counted under the key it names and left
// as it is, and every other value still moves.
func TestRunLeavesWhatNoKeyOpens(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	old := manager(t, "k1", "k1")
	rotated := manager(t, "k2", "k1", "k2")
	seedEveryColumn(t, pg, old)

	// Sealed with a key the configuration no longer lists.
	lost := seal(t, manager(t, "k0", "k0"), "lost")
	exec(t, pg.DB, `UPDATE user_mfa_totp SET secret_encrypted = $1`, lost)
	// Names k1, and is not what k1 sealed.
	parts := strings.Split(seal(t, old, "tampered"), ":")
	ciphertext, err := base64.RawURLEncoding.DecodeString(parts[4])
	if err != nil {
		t.Fatalf("decode the ciphertext: %v", err)
	}
	ciphertext[0] ^= 1
	parts[4] = base64.RawURLEncoding.EncodeToString(ciphertext)
	tampered := strings.Join(parts, ":")
	exec(t, pg.DB, `UPDATE tenant_payment_config SET credentials_encrypted = jsonb_set(credentials_encrypted, '{secret_key}', to_jsonb($1::text))`, tampered)
	before := snapshot(t, pg.DB)

	var logs bytes.Buffer
	report, err := secretreseal.Run(context.Background(), pg.DB, rotated, secretreseal.Options{
		Logger: slog.New(slog.NewTextHandler(&logs, nil)),
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := map[string]secretreseal.Counts{
		"k0": {Unreadable: 1},
		"k1": {Resealed: len(before) - 2, Unreadable: 1},
	}
	if !maps.Equal(report.Keys, want) {
		t.Fatalf("report = %+v, want %+v", report.Keys, want)
	}
	if report.Unreadable() != 2 {
		t.Fatalf("Unreadable = %d, want 2", report.Unreadable())
	}

	after := snapshot(t, pg.DB)
	for k, v := range after {
		switch v {
		case lost, tampered:
			if before[k] != v {
				t.Fatalf("%s changed although no key opens it", k)
			}
		default:
			if id, _ := secretcrypto.EnvelopeKeyID(v); id != "k2" {
				t.Fatalf("%s is sealed with %s after the run, want k2", k, id)
			}
		}
	}
	for _, want := range []string{"column=user_mfa_totp.secret_encrypted", "key_id=k0", "column=tenant_payment_config.credentials_encrypted", "path=$.secret_key"} {
		if !strings.Contains(logs.String(), want) {
			t.Fatalf("log does not name %q:\n%s", want, logs.String())
		}
	}
}

// A save that commits while a run waits on its row is what the run then reads,
// rather than something the run's own write replaces.
func TestRunDoesNotOverwriteASaveItWaitedFor(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()
	rotated := manager(t, "k2", "k1", "k2")
	seedEveryColumn(t, pg, manager(t, "k1", "k1"))
	total := len(snapshot(t, pg.DB))

	save, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer save.Rollback() //nolint:errcheck
	saved := seal(t, rotated, "NEWSECRET")
	if _, err := save.ExecContext(ctx, `UPDATE user_mfa_totp SET secret_encrypted = $1`, saved); err != nil {
		t.Fatalf("save: %v", err)
	}

	type result struct {
		report secretreseal.Report
		err    error
	}
	done := make(chan result, 1)
	go func() {
		report, err := secretreseal.Run(ctx, pg.DB, rotated, secretreseal.Options{})
		done <- result{report, err}
	}()
	testutil.WaitForBlockedBackend(t, pg.DB)
	if err := save.Commit(); err != nil {
		t.Fatalf("commit the save: %v", err)
	}
	r := <-done
	if r.err != nil {
		t.Fatalf("Run: %v", r.err)
	}
	want := map[string]secretreseal.Counts{"k1": {Resealed: total - 1}, "k2": {Current: 1}}
	if !maps.Equal(r.report.Keys, want) {
		t.Fatalf("report = %+v, want %+v", r.report.Keys, want)
	}
	var stored string
	if err := pg.DB.QueryRowContext(ctx, `SELECT secret_encrypted FROM user_mfa_totp`).Scan(&stored); err != nil {
		t.Fatalf("read user_mfa_totp: %v", err)
	}
	if stored != saved {
		t.Fatalf("the saved secret was replaced by the run")
	}
}

func mustTenantID(t *testing.T, db *sql.DB) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := db.QueryRowContext(context.Background(), `SELECT id FROM tenants LIMIT 1`).Scan(&id); err != nil {
		t.Fatalf("read the tenant: %v", err)
	}
	return id
}

func outboxPayload(t *testing.T, db *sql.DB, idempotencyKey string) string {
	t.Helper()
	var payload string
	if err := db.QueryRowContext(context.Background(),
		`SELECT payload::text FROM outbox_events WHERE idempotency_key = $1`, idempotencyKey,
	).Scan(&payload); err != nil {
		t.Fatalf("read the outbox event %s: %v", idempotencyKey, err)
	}
	return payload
}
