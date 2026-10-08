package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"log"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"golang.org/x/crypto/bcrypt"

	"github.com/publira/publira/server/internal/clientip"
)

// AccessTokenTTL is defined in jwt.go (24h).

// HashToken returns a hex-encoded SHA-256 digest (email tokens, reset tokens, etc.).
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func VerifyPassword(password, storedHash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password)) == nil
}

// VerifyUserPassword checks password against a users row. An account that
// signed up through a provider has no password, and no password matches it.
func VerifyUserPassword(password string, storedHash sql.NullString) bool {
	return storedHash.Valid && VerifyPassword(password, storedHash.String)
}

// BearerTokenFromHeader extracts the token from Authorization: Bearer <token>.
func BearerTokenFromHeader(headers *connect.Header) (string, bool) {
	return BearerToken(headers.Get("Authorization"))
}

// BearerToken extracts the token from an Authorization header value of the
// form "Bearer <token>".
func BearerToken(authorization string) (string, bool) {
	raw := strings.TrimSpace(authorization)
	if raw == "" {
		return "", false
	}
	const prefix = "Bearer "
	if len(raw) < len(prefix) || !strings.EqualFold(raw[:len(prefix)], prefix) {
		return "", false
	}
	token := strings.TrimSpace(raw[len(prefix):])
	if token == "" {
		return "", false
	}
	return token, true
}

// AuditEvent logs one step of a sign-in flow for the RPC ctx is serving, with
// the client address [clientip.Resolver.Middleware] determined for it.
func AuditEvent(ctx context.Context, action, outcome, tenantPublicID, userPublicID, reason string) {
	clientIP := clientip.FromContext(ctx)
	var userAgent string
	if info, ok := connect.CallInfoForServerContext(ctx); ok {
		userAgent = info.RequestHeader().Get("User-Agent")
	}
	log.Printf(
		"audit auth action=%s outcome=%s tenant_public_id=%s user_public_id=%s reason=%s client_ip=%s user_agent=%q",
		action,
		outcome,
		tenantPublicID,
		userPublicID,
		reason,
		clientIP,
		userAgent,
	)
}

// FormatExpiresAt formats token expiry for API responses.
func FormatExpiresAt(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}
