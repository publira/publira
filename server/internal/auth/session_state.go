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

type PlatformSessionLookupResult struct {
	Session dbmodels.PlatformSession
	State   SessionState
}

type SessionLookupQuerier interface {
	GetSessionByTokenHashForTenant(ctx context.Context, arg dbmodels.GetSessionByTokenHashForTenantParams) (dbmodels.Session, error)
}

type PlatformSessionLookupQuerier interface {
	GetPlatformSessionByTokenHash(ctx context.Context, tokenHash string) (dbmodels.PlatformSession, error)
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

func ClassifyPlatformSession(session dbmodels.PlatformSession, now time.Time) SessionState {
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

func LookupPlatformSessionByTokenHash(ctx context.Context, queries PlatformSessionLookupQuerier, tokenHash string, now time.Time) (PlatformSessionLookupResult, error) {
	session, err := queries.GetPlatformSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		return PlatformSessionLookupResult{}, err
	}
	return PlatformSessionLookupResult{
		Session: session,
		State:   ClassifyPlatformSession(session, now),
	}, nil
}
