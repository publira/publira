package auth

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
)

func TestClassifySessionBoundary(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	active := ClassifySession(dbmodels.Session{ExpiresAt: now.Add(time.Nanosecond)}, now)
	if active != SessionStateActive {
		t.Fatalf("expected active, got %s", active)
	}

	expired := ClassifySession(dbmodels.Session{ExpiresAt: now}, now)
	if expired != SessionStateExpired {
		t.Fatalf("expected expired, got %s", expired)
	}

	revoked := ClassifySession(dbmodels.Session{ExpiresAt: now.Add(time.Minute), RevokedAt: sql.NullTime{Time: now, Valid: true}}, now)
	if revoked != SessionStateRevoked {
		t.Fatalf("expected revoked, got %s", revoked)
	}
}

func TestLookupSessionByTokenHashForTenant(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC().Truncate(time.Microsecond)
	tests := []struct {
		name      string
		expiresAt time.Time
		revokedAt sql.NullTime
		want      SessionState
	}{
		{name: "active", expiresAt: now.Add(time.Minute), want: SessionStateActive},
		{name: "expired", expiresAt: now, want: SessionStateExpired},
		{name: "revoked", expiresAt: now.Add(time.Minute), revokedAt: sql.NullTime{Time: now.Add(-time.Minute), Valid: true}, want: SessionStateRevoked},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			t.Cleanup(func() { _ = db.Close() })

			queries := dbmodels.New(db)
			tenantID := uuid.Must(uuid.NewV7())
			sessionID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())

			rows := sqlmock.NewRows([]string{"id", "tenant_id", "user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
				AddRow(sessionID, tenantID, userID, "hashed-token", tc.expiresAt, nullTimeValue(tc.revokedAt), now)

			mock.ExpectQuery(regexp.QuoteMeta("FROM sessions")).
				WithArgs(tenantID, "hashed-token").
				WillReturnRows(rows)

			result, err := LookupSessionByTokenHashForTenant(context.Background(), queries, tenantID, "hashed-token", now)
			if err != nil {
				t.Fatalf("LookupSessionByTokenHashForTenant: %v", err)
			}
			if result.State != tc.want {
				t.Fatalf("state mismatch: got %s want %s", result.State, tc.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet: %v", err)
			}
		})
	}
}

func TestLookupSessionByTokenHashForTenant_NotFound(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	queries := dbmodels.New(db)
	tenantID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta("FROM sessions")).
		WithArgs(tenantID, "missing-token").
		WillReturnError(sql.ErrNoRows)

	_, err = LookupSessionByTokenHashForTenant(context.Background(), queries, tenantID, "missing-token", time.Now())
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("error = %v, want %v", err, sql.ErrNoRows)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet: %v", err)
	}
}

func nullTimeValue(value sql.NullTime) any {
	if !value.Valid {
		return nil
	}
	return value.Time
}
