package auth

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	// AccessTokenTTL matches the previous session TTL.
	AccessTokenTTL = 24 * time.Hour

	JWTIssuer = "publira"

	AudiencePublic   = "public"
	AudienceAdmin    = "admin"
	AudiencePlatform = "platform"
)

// AccessTokenClaims are the claims embedded in API access tokens.
type AccessTokenClaims struct {
	// TenantID is the tenant primary key (UUID). JSON key remains "tid" for wire stability.
	TenantID           string `json:"tid,omitempty"`
	Role               string `json:"role,omitempty"`
	CredentialsVersion int32  `json:"cv"`
	jwt.RegisteredClaims
}

// TokenManager issues and verifies HS256 access tokens.
type TokenManager struct {
	secret []byte
}

// NewTokenManagerFromEnv loads AUTH_JWT_SECRET (required in production paths).
// When empty, returns an error unless allowEmpty is used via NewTokenManager.
func NewTokenManagerFromEnv() (*TokenManager, error) {
	secret := strings.TrimSpace(os.Getenv("AUTH_JWT_SECRET"))
	if secret == "" {
		return nil, errors.New("AUTH_JWT_SECRET is required")
	}
	if len(secret) < 32 {
		return nil, errors.New("AUTH_JWT_SECRET must be at least 32 characters")
	}
	return NewTokenManager([]byte(secret)), nil
}

// NewTokenManager constructs a manager from an explicit secret.
func NewTokenManager(secret []byte) *TokenManager {
	return &TokenManager{secret: secret}
}

// Issue creates a signed JWT access token.
// tenantID should be the tenant primary key (UUID string); empty for platform tokens.
func (m *TokenManager) Issue(
	subjectPublicID string,
	audience string,
	tenantID string,
	role string,
	credentialsVersion int32,
	now time.Time,
) (token string, expiresAt time.Time, err error) {
	if m == nil || len(m.secret) == 0 {
		return "", time.Time{}, errors.New("token manager is not configured")
	}
	subjectPublicID = strings.TrimSpace(subjectPublicID)
	if subjectPublicID == "" {
		return "", time.Time{}, errors.New("subject is required")
	}
	audience = strings.TrimSpace(audience)
	if audience == "" {
		return "", time.Time{}, errors.New("audience is required")
	}

	expiresAt = now.Add(AccessTokenTTL)
	claims := AccessTokenClaims{
		TenantID:           strings.TrimSpace(tenantID),
		Role:               strings.TrimSpace(role),
		CredentialsVersion: credentialsVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    JWTIssuer,
			Subject:   subjectPublicID,
			Audience:  jwt.ClaimStrings{audience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := t.SignedString(m.secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expiresAt, nil
}

// Verify parses and validates a JWT for the expected audience.
func (m *TokenManager) Verify(tokenString string, expectedAudience string) (*AccessTokenClaims, error) {
	if m == nil || len(m.secret) == 0 {
		return nil, errors.New("token manager is not configured")
	}
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return nil, errors.New("token is required")
	}

	claims := &AccessTokenClaims{}
	parsed, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	}, jwt.WithIssuer(JWTIssuer), jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return nil, err
	}
	if !parsed.Valid {
		return nil, errors.New("invalid token")
	}

	expectedAudience = strings.TrimSpace(expectedAudience)
	if expectedAudience != "" {
		ok := false
		for _, a := range claims.Audience {
			if a == expectedAudience {
				ok = true
				break
			}
		}
		if !ok {
			return nil, errors.New("invalid audience")
		}
	}
	if strings.TrimSpace(claims.Subject) == "" {
		return nil, errors.New("missing subject")
	}
	return claims, nil
}
