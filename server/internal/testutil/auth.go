package testutil

import "github.com/publira/publira/server/internal/auth"

// JWTSecret keys the access tokens tests mint and the handlers under test
// verify. It is a test fixture, not a fallback: production builds its manager
// with auth.NewTokenManagerFromEnv in cmd/, so PUBLIRA_AUTH_JWT_SECRET is the
// only way a running server gets a signing key.
const JWTSecret = "publira-test-auth-jwt-secret-32b!"

// TokenManager returns the manager to hand to a package's NewHandler and to
// mint the tokens its requests carry, so both sides share one key.
func TokenManager() *auth.TokenManager {
	return auth.NewTokenManager([]byte(JWTSecret))
}
