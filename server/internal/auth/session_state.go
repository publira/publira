package auth

import (
	"context"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
)

type SessionState string

const (
	SessionStateActive  SessionState = "active"
	SessionStateExpired SessionState = "expired"
	SessionStateRevoked SessionState = "revoked"
)

type SessionLookupResult struct {
	Session dbmodels.Session
	State   SessionState
}

type SessionLookupQuerier interface {
	GetSessionByTokenHashForTenant(ctx context.Context, arg dbmodels.GetSessionByTokenHashForTenantParams) (dbmodels.Session, error)
}

func ClassifySession(session dbmodels.Session, now time.Time) SessionState {
	if session.RevokedAt.Valid {
		return SessionStateRevoked
	}
	if !session.ExpiresAt.After(now) {
		return SessionStateExpired
	}
	return SessionStateActive
}

func LookupSessionByTokenHashForTenant(ctx context.Context, queries SessionLookupQuerier, tenantID uuid.UUID, tokenHash string, now time.Time) (SessionLookupResult, error) {
	session, err := queries.GetSessionByTokenHashForTenant(ctx, dbmodels.GetSessionByTokenHashForTenantParams{
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
