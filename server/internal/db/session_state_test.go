package dbmodels

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestCreateSession(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	queries := New(db)
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionID := uuid.New()
	tenantID := uuid.New()
	userID := uuid.New()

	rows := sqlmock.NewRows([]string{"id", "tenant_id", "user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
		AddRow(sessionID, tenantID, userID, "hashed-token", now.Add(24*time.Hour), nil, now)

	mock.ExpectQuery(regexp.QuoteMeta(createSession)).
		WithArgs(sessionID, tenantID, userID, "hashed-token", now.Add(24*time.Hour)).
		WillReturnRows(rows)

	session, err := queries.CreateSession(context.Background(), CreateSessionParams{
		ID:        sessionID,
		TenantID:  tenantID,
		UserID:    userID,
		TokenHash: "hashed-token",
		ExpiresAt: now.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if session.TenantID != tenantID {
		t.Fatalf("tenant mismatch: got %s want %s", session.TenantID, tenantID)
	}
	if session.TokenHash != "hashed-token" {
		t.Fatalf("token hash mismatch: got %q", session.TokenHash)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet: %v", err)
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
		{
			name:      "active",
			expiresAt: now.Add(time.Minute),
			want:      SessionStateActive,
		},
		{
			name:      "expired",
			expiresAt: now,
			want:      SessionStateExpired,
		},
		{
			name:      "revoked",
			expiresAt: now.Add(time.Minute),
			revokedAt: sql.NullTime{Time: now.Add(-time.Minute), Valid: true},
			want:      SessionStateRevoked,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			t.Cleanup(func() { _ = db.Close() })

			queries := New(db)
			tenantID := uuid.New()
			sessionID := uuid.New()
			userID := uuid.New()

			rows := sqlmock.NewRows([]string{"id", "tenant_id", "user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
				AddRow(sessionID, tenantID, userID, "hashed-token", tc.expiresAt, nullTimeValue(tc.revokedAt), now)

			mock.ExpectQuery(regexp.QuoteMeta(getSessionByTokenHashForTenant)).
				WithArgs(tenantID, "hashed-token").
				WillReturnRows(rows)

			result, err := queries.LookupSessionByTokenHashForTenant(context.Background(), tenantID, "hashed-token", now)
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

func TestClassifySessionBoundary(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	active := ClassifySession(Session{ExpiresAt: now.Add(time.Nanosecond)}, now)
	if active != SessionStateActive {
		t.Fatalf("expected active, got %s", active)
	}

	expired := ClassifySession(Session{ExpiresAt: now}, now)
	if expired != SessionStateExpired {
		t.Fatalf("expected expired, got %s", expired)
	}
}

func TestRevokeSession(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	queries := New(db)
	sessionID := uuid.New()
	tenantID := uuid.New()

	mock.ExpectExec(regexp.QuoteMeta(revokeSession)).
		WithArgs(sessionID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := queries.RevokeSession(context.Background(), RevokeSessionParams{ID: sessionID, TenantID: tenantID}); err != nil {
		t.Fatalf("RevokeSession: %v", err)
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