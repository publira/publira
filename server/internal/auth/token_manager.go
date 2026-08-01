package auth

import (
	"os"
	"strings"
)

// DefaultTestJWTSecret is used when AUTH_JWT_SECRET is unset (local tests).
const DefaultTestJWTSecret = "publira-dev-auth-jwt-secret-32b!"

// MustTokenManagerFromEnv returns a TokenManager from AUTH_JWT_SECRET,
// falling back to DefaultTestJWTSecret when unset (dev/test).
func MustTokenManagerFromEnv() *TokenManager {
	secret := strings.TrimSpace(os.Getenv("AUTH_JWT_SECRET"))
	if secret == "" {
		secret = DefaultTestJWTSecret
	}
	return NewTokenManager([]byte(secret))
}
