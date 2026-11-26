package dbtest

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before the
// devices a reader already held were trimmed to the cap, and the one that
// trimmed them.
const (
	beforePushDeviceTrimVersion = 20261125183003
	pushDeviceTrimVersion       = 20261125183004
)

// A reader who held more push devices than the cap before it existed keeps the
// 20 updated most recently, and a reader under it keeps every one.
func TestPushDeviceTrimMigrationKeepsTheNewestPerReader(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	pg.MigrateTo(t, beforePushDeviceTrimVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	tenant := pg.SeedTenantOnOlderSchema(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Inserted by hand: the generated queries read back every column on the
	// newest schema, which this one predates.
	reader := func(publicID string) uuid.UUID {
		t.Helper()
		id := uuid.Must(uuid.NewV7())
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO users (id, tenant_id, public_id, email, password_hash, name)
			VALUES ($1, $2, $3, $4, '', 'Reader')
		`, id, tenant.ID, publicID, publicID+"@tenant-a.example.com"); err != nil {
			t.Fatalf("insert reader: %v", err)
		}
		return id
	}
	flooding := reader("ENDUSERA0001")
	ordinary := reader("ENDUSERA0002")

	start := time.Now().Add(-time.Hour).UTC().Truncate(time.Microsecond)
	device := func(userID uuid.UUID, token string, updatedAt time.Time) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO user_push_devices (tenant_id, user_id, token, platform, created_at, updated_at)
			VALUES ($1, $2, $3, 'android', $4, $4)
		`, tenant.ID, userID, token, updatedAt); err != nil {
			t.Fatalf("insert device %s: %v", token, err)
		}
	}
	for i := range 25 {
		device(flooding, fmt.Sprintf("flooding-%02d", i), start.Add(time.Duration(i)*time.Second))
	}
	for i := range 3 {
		device(ordinary, fmt.Sprintf("ordinary-%02d", i), start.Add(time.Duration(i)*time.Second))
	}

	pg.MigrateTo(t, pushDeviceTrimVersion)

	held := func(userID uuid.UUID) map[string]bool {
		t.Helper()
		rows, err := pg.DB.QueryContext(ctx, `SELECT token FROM user_push_devices WHERE user_id = $1`, userID)
		if err != nil {
			t.Fatalf("list devices: %v", err)
		}
		defer rows.Close() //nolint:errcheck
		tokens := map[string]bool{}
		for rows.Next() {
			var token string
			if err := rows.Scan(&token); err != nil {
				t.Fatalf("scan device: %v", err)
			}
			tokens[token] = true
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("list devices: %v", err)
		}
		return tokens
	}

	got := held(flooding)
	if len(got) != 20 {
		t.Fatalf("flooding reader's devices = %d, want 20", len(got))
	}
	for i := range 5 {
		if token := fmt.Sprintf("flooding-%02d", i); got[token] {
			t.Fatalf("%s is still held, want the oldest past the cap removed", token)
		}
	}
	if !got["flooding-24"] {
		t.Fatal("flooding-24 was removed, want the newest kept")
	}
	if n := len(held(ordinary)); n != 3 {
		t.Fatalf("ordinary reader's devices = %d, want all 3 kept", n)
	}
}
