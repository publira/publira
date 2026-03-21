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

const (
	SessionCookieName = "publira_session"
	SessionTTL        = 24 * time.Hour
)

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

func BuildSessionCookie(token string, expiresAt time.Time) string {
	cookie := &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
	}
	return cookie.String()
}

func BuildClearedSessionCookie() string {
	cookie := &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	}
	return cookie.String()
}

func SessionTokenFromRequest(explicitToken string, headers http.Header) (string, bool) {
	token := strings.TrimSpace(explicitToken)
	if token != "" {
		return token, true
	}
	request := &http.Request{Header: headers}
	cookie, err := request.Cookie(SessionCookieName)
	if err != nil {
		return "", false
	}
	if strings.TrimSpace(cookie.Value) == "" {
		return "", false
	}
	return cookie.Value, true
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
