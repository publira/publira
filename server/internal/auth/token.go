package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
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

// BearerTokenFromHeader extracts the token from Authorization: Bearer <token>.
func BearerTokenFromHeader(headers http.Header) (string, bool) {
	if headers == nil {
		return "", false
	}
	raw := strings.TrimSpace(headers.Get("Authorization"))
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

func firstForwardedIP(headerValue string) string {
	parts := strings.Split(headerValue, ",")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func AuditEvent(headers http.Header, action, outcome, tenantPublicID, userPublicID, reason string) {
	clientIP := firstForwardedIP(headers.Get("X-Forwarded-For"))
	userAgent := headers.Get("User-Agent")
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
