package dbmodels

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type SessionState string

const (
	SessionStateActive  SessionState = "active"
	SessionStateExpired SessionState = "expired"
	SessionStateRevoked SessionState = "revoked"
)

type SessionLookupResult struct {
	Session Session
	State   SessionState
}

func ClassifySession(session Session, now time.Time) SessionState {
	if session.RevokedAt.Valid {
		return SessionStateRevoked
	}
	if !session.ExpiresAt.After(now) {
		return SessionStateExpired
	}
	return SessionStateActive
}

func (q *Queries) LookupSessionByTokenHashForTenant(ctx context.Context, tenantID uuid.UUID, tokenHash string, now time.Time) (SessionLookupResult, error) {
	session, err := q.GetSessionByTokenHashForTenant(ctx, GetSessionByTokenHashForTenantParams{
		TenantID:  tenantID,
		TokenHash: tokenHash,
	})
	if err != nil {
		return SessionLookupResult{}, err
	}
	return SessionLookupResult{
		Session: session,
		State:   ClassifySession(session, now),
	}, nil
}