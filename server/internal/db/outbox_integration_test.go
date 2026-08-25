package dbmodels_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	outboxEventType          = "tenant_admin_invitation_email"
	insufficientPrivilegeSQL = "42501"
)

func tenantOutboxPayload(tenantID uuid.UUID) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"tenant_id":%q}`, tenantID.String()))
}

func insertTenantOutboxEvent(
	t *testing.T,
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	idempotencyKey string,
	availableAt time.Time,
) dbmodels.OutboxEvent {
	t.Helper()
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outboxEventType,
		Payload:        tenantOutboxPayload(tenantID),
		IdempotencyKey: idempotencyKey,
		AvailableAt:    availableAt,
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent %s: %v", idempotencyKey, err)
	}
	return event
}

func TestInsertOutboxEventIgnoresDuplicateIdempotencyKey(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTEN001", "outbox.example.com", "admin-outbox.example.com", "Outbox Tenant")
	queries := dbmodels.New(pg.DB)
	now := time.Now().UTC().Truncate(time.Microsecond)
	key := "invite_email:" + uuid.Must(uuid.NewV7()).String()

	first := insertTenantOutboxEvent(t, ctx, queries, tenantID, key, now)

	_, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outboxEventType,
		Payload:        tenantOutboxPayload(tenantID),
		IdempotencyKey: key,
		AvailableAt:    now,
	})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("duplicate InsertOutboxEvent error = %v, want sql.ErrNoRows", err)
	}

	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO outbox_events (id, tenant_id, event_type, payload, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)
	`, uuid.Must(uuid.NewV7()), tenantID, outboxEventType, tenantOutboxPayload(tenantID), key)
	if !isUniqueViolation(err) {
		t.Fatalf("raw duplicate idempotency_key error = %v, want unique_violation", err)
	}

	got, err := queries.GetOutboxEventByIdempotencyKey(ctx, key)
	if err != nil {
		t.Fatalf("GetOutboxEventByIdempotencyKey: %v", err)
	}
	if got.ID != first.ID {
		t.Fatalf("stored id = %s, want %s", got.ID, first.ID)
	}
	if got.Status != "pending" {
		t.Fatalf("status = %q, want pending", got.Status)
	}
	if got.Attempts != 0 {
		t.Fatalf("attempts = %d, want 0", got.Attempts)
	}
}

func TestOutboxEventTenantPayloadCheck(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTEN001", "outbox.example.com", "admin-outbox.example.com", "Outbox Tenant")
	otherTenantID := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTEN002", "outbox-b.example.com", "admin-outbox-b.example.com", "Outbox Tenant B")

	cases := []struct {
		name    string
		payload json.RawMessage
	}{
		{name: "missing tenant_id", payload: json.RawMessage(`{}`)},
		{name: "mismatched tenant_id", payload: tenantOutboxPayload(otherTenantID)},
	}
	for _, tc := range cases {
		_, err := pg.DB.ExecContext(ctx, `
			INSERT INTO outbox_events (id, tenant_id, event_type, payload, idempotency_key)
			VALUES ($1, $2, $3, $4, $5)
		`, uuid.Must(uuid.NewV7()), tenantID, outboxEventType, tc.payload, "key:"+tc.name)
		if !isCheckViolation(err) {
			t.Fatalf("%s error = %v, want check_violation", tc.name, err)
		}
		if checkName(err) != "outbox_events_tenant_payload_check" {
			t.Fatalf("%s constraint = %q, want outbox_events_tenant_payload_check", tc.name, checkName(err))
		}
	}

	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO outbox_events (id, event_type, payload, idempotency_key)
		VALUES ($1, $2, $3, $4)
	`, uuid.Must(uuid.NewV7()), "platform_operator_invite_email", json.RawMessage(`{}`), "platform:ok"); err != nil {
		t.Fatalf("platform event with null tenant_id: %v", err)
	}
}

func TestOutboxEventStatusAndBlankChecks(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTEN001", "outbox.example.com", "admin-outbox.example.com", "Outbox Tenant")
	payload := tenantOutboxPayload(tenantID)

	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO outbox_events (id, tenant_id, event_type, payload, idempotency_key, status)
		VALUES ($1, $2, $3, $4, $5, 'queued')
	`, uuid.Must(uuid.NewV7()), tenantID, outboxEventType, payload, "status:queued")
	if !isCheckViolation(err) || checkName(err) != "outbox_events_status_check" {
		t.Fatalf("invalid status error = %v, want outbox_events_status_check", err)
	}

	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO outbox_events (id, tenant_id, event_type, payload, idempotency_key)
		VALUES ($1, $2, '', $3, $4)
	`, uuid.Must(uuid.NewV7()), tenantID, payload, "event_type:blank")
	if !isCheckViolation(err) || checkName(err) != "outbox_events_event_type_check" {
		t.Fatalf("blank event_type error = %v, want outbox_events_event_type_check", err)
	}

	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO outbox_events (id, tenant_id, event_type, payload, idempotency_key)
		VALUES ($1, $2, $3, $4, '')
	`, uuid.Must(uuid.NewV7()), tenantID, outboxEventType, payload)
	if !isCheckViolation(err) || checkName(err) != "outbox_events_idempotency_key_check" {
		t.Fatalf("blank idempotency_key error = %v, want outbox_events_idempotency_key_check", err)
	}
}

func TestClaimPendingOutboxEventsSkipsFutureAndTerminal(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTEN001", "outbox.example.com", "admin-outbox.example.com", "Outbox Tenant")
	queries := dbmodels.New(pg.DB)
	now := time.Now().UTC().Truncate(time.Microsecond)

	dueFirst := insertTenantOutboxEvent(t, ctx, queries, tenantID, "due:1", now.Add(-2*time.Minute))
	dueSecond := insertTenantOutboxEvent(t, ctx, queries, tenantID, "due:2", now.Add(-time.Minute))
	insertTenantOutboxEvent(t, ctx, queries, tenantID, "future:1", now.Add(time.Hour))

	done := insertTenantOutboxEvent(t, ctx, queries, tenantID, "done:1", now.Add(-3*time.Minute))
	if _, err := pg.DB.ExecContext(ctx, `UPDATE outbox_events SET status = 'done' WHERE id = $1`, done.ID); err != nil {
		t.Fatalf("mark done: %v", err)
	}

	claimed, err := queries.ClaimPendingOutboxEvents(ctx, 10)
	if err != nil {
		t.Fatalf("ClaimPendingOutboxEvents: %v", err)
	}
	if len(claimed) != 2 {
		t.Fatalf("claimed = %d, want 2", len(claimed))
	}
	if claimed[0].ID != dueFirst.ID || claimed[1].ID != dueSecond.ID {
		t.Fatalf("claim order = [%s %s], want [%s %s]", claimed[0].ID, claimed[1].ID, dueFirst.ID, dueSecond.ID)
	}
	for _, event := range claimed {
		if event.Status != "processing" {
			t.Fatalf("claimed status = %q, want processing", event.Status)
		}
	}

	again, err := queries.ClaimPendingOutboxEvents(ctx, 10)
	if err != nil {
		t.Fatalf("second ClaimPendingOutboxEvents: %v", err)
	}
	if len(again) != 0 {
		t.Fatalf("second claim = %d, want 0", len(again))
	}
}

func TestOutboxEventStatusTransitions(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTEN001", "outbox.example.com", "admin-outbox.example.com", "Outbox Tenant")
	queries := dbmodels.New(pg.DB)
	now := time.Now().UTC().Truncate(time.Microsecond)

	doneEvent := insertTenantOutboxEvent(t, ctx, queries, tenantID, "transition:done", now.Add(-time.Minute))
	retryEvent := insertTenantOutboxEvent(t, ctx, queries, tenantID, "transition:retry", now.Add(-time.Minute))
	deadEvent := insertTenantOutboxEvent(t, ctx, queries, tenantID, "transition:dead", now.Add(-time.Minute))
	if _, err := queries.ClaimPendingOutboxEvents(ctx, 10); err != nil {
		t.Fatalf("claim: %v", err)
	}

	markedDone, err := queries.MarkOutboxEventDone(ctx, doneEvent.ID)
	if err != nil {
		t.Fatalf("MarkOutboxEventDone: %v", err)
	}
	if markedDone.Status != "done" {
		t.Fatalf("done status = %q", markedDone.Status)
	}
	if markedDone.LastError.Valid {
		t.Fatalf("done last_error = %q, want NULL", markedDone.LastError.String)
	}

	retryAt := now.Add(5 * time.Minute)
	retried, err := queries.MarkOutboxEventRetry(ctx, dbmodels.MarkOutboxEventRetryParams{
		ID:          retryEvent.ID,
		AvailableAt: retryAt,
		LastError:   sql.NullString{String: "smtp timeout", Valid: true},
	})
	if err != nil {
		t.Fatalf("MarkOutboxEventRetry: %v", err)
	}
	if retried.Status != "pending" {
		t.Fatalf("retry status = %q, want pending", retried.Status)
	}
	if retried.Attempts != 1 {
		t.Fatalf("retry attempts = %d, want 1", retried.Attempts)
	}
	if retried.LastError.String != "smtp timeout" {
		t.Fatalf("retry last_error = %q", retried.LastError.String)
	}

	dead, err := queries.MarkOutboxEventDead(ctx, dbmodels.MarkOutboxEventDeadParams{
		ID:        deadEvent.ID,
		LastError: sql.NullString{String: "max attempts", Valid: true},
	})
	if err != nil {
		t.Fatalf("MarkOutboxEventDead: %v", err)
	}
	if dead.Status != "dead" {
		t.Fatalf("dead status = %q", dead.Status)
	}
	if dead.Attempts != 1 {
		t.Fatalf("dead attempts = %d, want 1", dead.Attempts)
	}

	_, err = queries.MarkOutboxEventDone(ctx, doneEvent.ID)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("done again error = %v, want sql.ErrNoRows", err)
	}
}

func TestOutboxEventsExplainUsesPendingIndex(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTEN001", "outbox.example.com", "admin-outbox.example.com", "Outbox Tenant")
	queries := dbmodels.New(pg.DB)
	insertTenantOutboxEvent(t, ctx, queries, tenantID, "explain:1", time.Now().UTC().Add(-time.Minute))

	tx, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatalf("disable seqscan: %v", err)
	}

	rows, err := tx.QueryContext(ctx, `
		EXPLAIN SELECT id
		FROM outbox_events
		WHERE status = 'pending' AND available_at <= NOW()
		ORDER BY available_at ASC, id ASC
		LIMIT 20
	`)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan explain: %v", err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("explain rows: %v", err)
	}
	if err := rows.Close(); err != nil {
		t.Fatalf("close explain: %v", err)
	}
	if !strings.Contains(plan.String(), "idx_outbox_events_pending_available_at") {
		t.Fatalf("plan did not use idx_outbox_events_pending_available_at:\n%s", plan.String())
	}
}

func TestOutboxEventsRLSHidesOtherTenantAndPlatformRows(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantA := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTENA01", "outbox-a.example.com", "admin-outbox-a.example.com", "Outbox A")
	tenantB := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTENB01", "outbox-b.example.com", "admin-outbox-b.example.com", "Outbox B")
	queries := dbmodels.New(pg.DB)
	now := time.Now().UTC().Truncate(time.Microsecond)

	mine := insertTenantOutboxEvent(t, ctx, queries, tenantA, "rls:a", now)
	theirs := insertTenantOutboxEvent(t, ctx, queries, tenantB, "rls:b", now)
	platform, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		EventType:      "platform_operator_invite_email",
		Payload:        json.RawMessage(`{}`),
		IdempotencyKey: "rls:platform",
		AvailableAt:    now,
	})
	if err != nil {
		t.Fatalf("insert platform event: %v", err)
	}

	withAdminTenant(t, pg, tenantA, func(ctx context.Context, conn *sql.Conn) {
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM outbox_events").Scan(&visible); err != nil {
			t.Fatalf("count outbox_events: %v", err)
		}
		if visible != 1 {
			t.Fatalf("visible events = %d, want 1", visible)
		}

		var status string
		err := conn.QueryRowContext(ctx, "SELECT status FROM outbox_events WHERE id = $1", theirs.ID).Scan(&status)
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("read tenant B event error = %v, want sql.ErrNoRows", err)
		}
		err = conn.QueryRowContext(ctx, "SELECT status FROM outbox_events WHERE id = $1", platform.ID).Scan(&status)
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("read platform event error = %v, want sql.ErrNoRows", err)
		}
		if err := conn.QueryRowContext(ctx, "SELECT status FROM outbox_events WHERE id = $1", mine.ID).Scan(&status); err != nil {
			t.Fatalf("read own event: %v", err)
		}

		_, err = conn.ExecContext(ctx, `
			INSERT INTO outbox_events (id, tenant_id, event_type, payload, idempotency_key)
			VALUES ($1, $2, $3, $4, $5)
		`, uuid.Must(uuid.NewV7()), tenantB, outboxEventType, tenantOutboxPayload(tenantB), "rls:planted")
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilegeSQL {
			t.Fatalf("insert for another tenant error = %v, want SQLSTATE %s", err, insufficientPrivilegeSQL)
		}

		_, err = conn.ExecContext(ctx, `
			INSERT INTO outbox_events (id, event_type, payload, idempotency_key)
			VALUES ($1, $2, $3, $4)
		`, uuid.Must(uuid.NewV7()), "platform_operator_invite_email", json.RawMessage(`{}`), "rls:null")
		if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilegeSQL {
			t.Fatalf("insert null tenant_id error = %v, want SQLSTATE %s", err, insufficientPrivilegeSQL)
		}
	})

	platformDB := pg.OpenPlatformDB(t)
	var all int
	if err := platformDB.QueryRowContext(ctx, "SELECT count(*) FROM outbox_events").Scan(&all); err != nil {
		t.Fatalf("platform count: %v", err)
	}
	if all != 3 {
		t.Fatalf("platform visible events = %d, want 3", all)
	}
}

func TestOutboxEventsRLSHidesEverythingWithoutTenantSetting(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTEN001", "outbox.example.com", "admin-outbox.example.com", "Outbox Tenant")
	insertTenantOutboxEvent(t, ctx, dbmodels.New(pg.DB), tenantID, "rls:none", time.Now().UTC())

	db := pg.OpenAdminDB(t)
	var visible int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM outbox_events").Scan(&visible); err != nil {
		t.Fatalf("count outbox_events: %v", err)
	}
	if visible != 0 {
		t.Fatalf("events visible without a tenant setting = %d, want 0", visible)
	}
}

func TestOutboxEventsCascadeOnTenantDelete(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "OUTBOXTEN001", "outbox.example.com", "admin-outbox.example.com", "Outbox Tenant")
	insertTenantOutboxEvent(t, ctx, dbmodels.New(pg.DB), tenantID, "cascade:1", time.Now().UTC())

	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM tenants WHERE id = $1`, tenantID); err != nil {
		t.Fatalf("delete tenant: %v", err)
	}
	var remaining int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM outbox_events`).Scan(&remaining); err != nil {
		t.Fatalf("count after tenant delete: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("events after tenant delete = %d, want 0 (CASCADE)", remaining)
	}
}
