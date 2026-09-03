package auth

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	// AccessTokenTTL matches the previous session TTL.
	AccessTokenTTL = 24 * time.Hour

	// MediaTokenTTL bounds how long a media URL keeps working after it leaves
	// the API response. It has to outlive the reader's page render and the
	// private caches in front of it, and stay short enough that a copied URL
	// is not a session.
	MediaTokenTTL = 15 * time.Minute

	// MFAChallengeTTL bounds the half-finished session a correct password
	// earns while the second factor is still owed. It has to outlast reaching
	// for an authenticator and no longer.
	MFAChallengeTTL = 5 * time.Minute

	JWTIssuer = "publira"

	AudiencePublic   = "public"
	AudienceAdmin    = "admin"
	AudiencePlatform = "platform"
	// AudienceMedia marks the token image-server accepts from a URL query.
	// Keeping it out of AudiencePublic means a media token cannot be replayed
	// against the API, and an API access token cannot be pasted into an image
	// URL.
	AudienceMedia = "media"
	// AudienceAdminMedia is the admin-image-server counterpart: a URL-borne
	// credential for tenant staff, not a reader. Public image-server never
	// verifies this audience, so a copied admin preview URL cannot unlock
	// unpublished bodies on the public host.
	AudienceAdminMedia = "admin-media"
	// MediaTokenQueryParam is where an AudienceMedia or AudienceAdminMedia
	// token rides on an image URL. image-server ignores it when building its
	// conversion cache key, so two viewers of the same image still share one
	// cached rendition.
	MediaTokenQueryParam = "t"

	// AudienceAdminMFAVerify and AudienceAdminMFAEnroll mark the half-finished
	// admin session a correct password earns while a second factor is still
	// owed. They are separate audiences rather than a claim on AudienceAdmin
	// because every verifier already compares the audience exactly: a
	// challenge cannot be presented as a session, a session cannot be spent as
	// a challenge, and the token that may only complete an enrollment cannot
	// answer a verification challenge for an account that already has one.
	AudienceAdminMFAVerify = "admin-mfa-verify"
	AudienceAdminMFAEnroll = "admin-mfa-enroll"
)

// AccessTokenClaims are the claims embedded in API access tokens.
type AccessTokenClaims struct {
	// TenantID is the tenant primary key (UUID). JSON key remains "tid" for wire stability.
	TenantID           string `json:"tid,omitempty"`
	Role               string `json:"role,omitempty"`
	CredentialsVersion int32  `json:"cv"`
	// EpisodeID scopes an AudienceMedia or AudienceAdminMedia token to one
	// episode (primary key UUID). API access tokens leave it empty.
	EpisodeID string `json:"eid,omitempty"`
	jwt.RegisteredClaims
}

// TokenManager issues and verifies HS256 access tokens.
type TokenManager struct {
	secret []byte
}

// MinJWTSecretBytes is the shortest secret accepted for HS256. A key shorter
// than the digest it feeds contributes less entropy than the algorithm can
// carry, which RFC 7518 section 3.2 rules out for HS256.
const MinJWTSecretBytes = 32

// NewTokenManagerFromEnv builds the manager from PUBLIRA_AUTH_JWT_SECRET. Every
// server that verifies or issues access tokens calls this at startup, so a
// missing or too-short secret stops the process instead of surfacing on the
// first request.
func NewTokenManagerFromEnv() (*TokenManager, error) {
	secret := strings.TrimSpace(os.Getenv("PUBLIRA_AUTH_JWT_SECRET"))
	if secret == "" {
		return nil, errors.New("PUBLIRA_AUTH_JWT_SECRET is required")
	}
	// len() on a string counts UTF-8 bytes, which is what the HMAC key is.
	if len(secret) < MinJWTSecretBytes {
		return nil, fmt.Errorf("PUBLIRA_AUTH_JWT_SECRET must be at least %d bytes", MinJWTSecretBytes)
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
	subjectPublicID = strings.TrimSpace(subjectPublicID)
	if subjectPublicID == "" {
		return "", time.Time{}, errors.New("subject is required")
	}
	audience = strings.TrimSpace(audience)
	if audience == "" {
		return "", time.Time{}, errors.New("audience is required")
	}

	return m.sign(AccessTokenClaims{
		TenantID:           strings.TrimSpace(tenantID),
		Role:               strings.TrimSpace(role),
		CredentialsVersion: credentialsVersion,
	}, subjectPublicID, audience, "", AccessTokenTTL, now)
}

// IssueMediaToken creates the short-lived token that travels in an image URL
// query. A browser <img> request cannot set an Authorization header, so an
// entitled reader's request for a paid body image would otherwise reach
// image-server indistinguishable from an anonymous one. The token carries
// identity only: image-server still evaluates purchases and tickets against
// the database, and episodeID keeps a copied URL from unlocking anything
// beyond that one episode.
func (m *TokenManager) IssueMediaToken(
	subjectPublicID string,
	tenantID string,
	episodeID string,
	credentialsVersion int32,
	now time.Time,
) (token string, expiresAt time.Time, err error) {
	return m.issueScopedMediaToken(subjectPublicID, tenantID, episodeID, credentialsVersion, now, AudienceMedia)
}

// IssueAdminMediaToken is the admin-image-server counterpart of
// IssueMediaToken. The grant it names is tenant staff membership, not a
// purchase or ticket, and only admin-image-server verifies this audience.
func (m *TokenManager) IssueAdminMediaToken(
	subjectPublicID string,
	tenantID string,
	episodeID string,
	credentialsVersion int32,
	now time.Time,
) (token string, expiresAt time.Time, err error) {
	return m.issueScopedMediaToken(subjectPublicID, tenantID, episodeID, credentialsVersion, now, AudienceAdminMedia)
}

// IssueMFAChallengeToken creates the short-lived token that stands in for the
// session between a correct password and the second factor. audience picks
// what the challenge may complete: AudienceAdminMFAVerify for an account that
// owes a code, AudienceAdminMFAEnroll for one that owes an enrollment. It
// carries no role, so nothing that authorizes on one can act on it, and it
// carries the credentials version, so a password change ends it.
//
// Every challenge gets a `jti`. Nothing about a signed token changes when it
// is exchanged, so a single-use challenge needs a name the server can record
// as spent; that name is this identifier.
func (m *TokenManager) IssueMFAChallengeToken(
	subjectPublicID string,
	audience string,
	tenantID string,
	credentialsVersion int32,
	now time.Time,
) (token string, expiresAt time.Time, err error) {
	subjectPublicID = strings.TrimSpace(subjectPublicID)
	if subjectPublicID == "" {
		return "", time.Time{}, errors.New("subject is required")
	}
	switch strings.TrimSpace(audience) {
	case AudienceAdminMFAVerify, AudienceAdminMFAEnroll:
	default:
		return "", time.Time{}, errors.New("audience is not an mfa challenge audience")
	}
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return "", time.Time{}, errors.New("tenant is required")
	}
	tokenID, err := uuid.NewV7()
	if err != nil {
		return "", time.Time{}, err
	}
	return m.sign(AccessTokenClaims{
		TenantID:           tenantID,
		CredentialsVersion: credentialsVersion,
	}, subjectPublicID, strings.TrimSpace(audience), tokenID.String(), MFAChallengeTTL, now)
}

func (m *TokenManager) issueScopedMediaToken(
	subjectPublicID string,
	tenantID string,
	episodeID string,
	credentialsVersion int32,
	now time.Time,
	audience string,
) (token string, expiresAt time.Time, err error) {
	subjectPublicID = strings.TrimSpace(subjectPublicID)
	if subjectPublicID == "" {
		return "", time.Time{}, errors.New("subject is required")
	}
	// An access token may omit the tenant (platform tokens do), and verifiers
	// skip the tenant check when it is absent. A media token that took that
	// route would be accepted by every tenant's image-server, so it is
	// required here rather than merely expected.
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return "", time.Time{}, errors.New("tenant is required")
	}
	episodeID = strings.TrimSpace(episodeID)
	if episodeID == "" {
		return "", time.Time{}, errors.New("episode is required")
	}
	return m.sign(AccessTokenClaims{
		TenantID:           tenantID,
		CredentialsVersion: credentialsVersion,
		EpisodeID:          episodeID,
	}, subjectPublicID, audience, "", MediaTokenTTL, now)
}

// WithMediaTokenQuery hands an image URL the short-lived credential a
// browser <img> (or next/image loader) will send. image-server also reads
// sizing from the query, so the token is added to whatever query the URL
// already has rather than assuming there is none.
func WithMediaTokenQuery(imageURL string, token string) string {
	if token == "" {
		return imageURL
	}
	fragment := ""
	if before, after, found := strings.Cut(imageURL, "#"); found {
		imageURL = before
		fragment = "#" + after
	}
	separator := "?"
	if strings.Contains(imageURL, "?") {
		separator = "&"
	}
	return imageURL + separator + MediaTokenQueryParam + "=" + url.QueryEscape(token) + fragment
}

// sign builds the registered claims and returns the signed token. tokenID
// becomes the `jti`; it is empty for every token nothing has to spend, and
// carries the identifier an MFA challenge is claimed by.
func (m *TokenManager) sign(
	claims AccessTokenClaims,
	subjectPublicID string,
	audience string,
	tokenID string,
	ttl time.Duration,
	now time.Time,
) (string, time.Time, error) {
	if m == nil || len(m.secret) == 0 {
		return "", time.Time{}, errors.New("token manager is not configured")
	}
	expiresAt := now.Add(ttl)
	claims.RegisteredClaims = jwt.RegisteredClaims{
		ID:        tokenID,
		Issuer:    JWTIssuer,
		Subject:   subjectPublicID,
		Audience:  jwt.ClaimStrings{audience},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expiresAt),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
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
