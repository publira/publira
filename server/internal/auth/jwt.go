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

	// FreeEpisodeMediaTokenWindow is how often the media token on a free body's
	// image URL rotates. The token is derived from the window rather than from
	// the moment it was asked for, so every reader who opens one episode inside
	// one window is handed the identical URL — which is what keeps a free page
	// shareable by a CDN and by the cached episode read the public site serves
	// every reader from. image-server derives the image cipher's key from those
	// same bytes, so the window is also how often a copied URL, and ciphertext
	// saved from it, stops decoding.
	FreeEpisodeMediaTokenWindow = 24 * time.Hour

	// FreeEpisodeMediaTokenTTL is how long one of those tokens stays valid: two
	// windows, so a reader handed one at the very end of a window still has a
	// full window left. That floor is what a cache holding the token has to
	// stay under.
	FreeEpisodeMediaTokenTTL = 2 * FreeEpisodeMediaTokenWindow

	// FreeEpisodeMediaSubject stands in for the reader a free body's token does
	// not have. A user's public_id is exactly publicid.Length Base58
	// characters, so this value can never resolve to one: image-server finds
	// nobody, the token therefore names no grant, and the public rule —
	// published, and free to everyone — is left to decide exactly as it does
	// for a request that carries no token at all.
	FreeEpisodeMediaSubject = "anonymous-free-episode"

	// MFAChallengeTTL bounds the half-finished session a correct password
	// earns while the second factor is still owed. It has to outlast reaching
	// for an authenticator and no longer.
	MFAChallengeTTL = 5 * time.Minute

	// LoginDeviceTTL is how long the device a password sign-in was made from is
	// remembered by the sign-in limit. Every sign-in from the device answers a
	// fresh token, so it only runs out for a device nobody has signed in from
	// for that long, which is one the limit may treat as never seen.
	LoginDeviceTTL = 90 * 24 * time.Hour

	// StepUpTokenTTL is how long a console account's re-authentication keeps
	// admitting the operations that ask for one: long enough for one task of
	// several such steps, and short enough that a session lifted from a browser
	// left open is unlikely to come with one.
	StepUpTokenTTL = 15 * time.Minute

	JWTIssuer = "publira"

	AudiencePublic   = "public"
	AudienceAdmin    = "admin"
	AudiencePlatform = "platform"
	// AudienceMedia marks the token image-server accepts from a URL query.
	// Keeping it out of AudiencePublic means a media token cannot be replayed
	// against the API, and an API access token cannot be pasted into an image
	// URL.
	AudienceMedia = "media"
	// AudienceAdminMedia is the console's counterpart: a URL-borne credential
	// for tenant staff, not a reader. image-server verifies this audience only
	// on a console host, so a copied admin preview URL cannot unlock
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
	// AudiencePlatformMFAVerify and AudiencePlatformMFAEnroll are the platform
	// console's counterparts, kept apart from the admin ones so a challenge
	// one console earned cannot be completed at the other.
	AudiencePlatformMFAVerify = "platform-mfa-verify"
	AudiencePlatformMFAEnroll = "platform-mfa-enroll"
	// AudiencePublicMFAVerify is the site's counterpart, for a reader's
	// sign-in that owes a code. The site never requires the factor, so it has
	// no enroll audience, and an account that signed in to one of the consoles
	// cannot finish at the site with the challenge it earned there, nor the
	// other way round.
	AudiencePublicMFAVerify = "public-mfa-verify"
	// AudienceLoginDevice marks the token a sign-in whose password was right
	// hands the device it came from, for the sign-in limit to tell a device
	// that has signed in to an address before from one that never has. It
	// authorizes nothing: no RPC accepts it in place of a session, and its
	// subject names an address digest rather than an account.
	AudienceLoginDevice = "login-device"
	// AudienceAdminStepUp marks the token a tenant console account earns by
	// proving, on top of its session, that its owner is the one using it. It
	// is presented beside the session rather than in its place: no RPC takes it
	// as a session, and it admits nothing beside any session but the one it
	// was earned on.
	AudienceAdminStepUp = "admin-step-up"
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
	// BoundSessionID names, on an AudienceAdminStepUp token, the `jti` of the
	// session it was earned on. Every other token leaves it empty.
	BoundSessionID string `json:"sid,omitempty"`
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
// Every access token gets a `jti`, so that signing out can name the one session
// it ends; [AccessTokenClaims.SessionID] reads it back.
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
	tokenID, err := uuid.NewV7()
	if err != nil {
		return "", time.Time{}, err
	}

	return m.sign(AccessTokenClaims{
		TenantID:           strings.TrimSpace(tenantID),
		Role:               strings.TrimSpace(role),
		CredentialsVersion: credentialsVersion,
	}, subjectPublicID, audience, tokenID.String(), AccessTokenTTL, now)
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

// IssueAdminMediaToken is the console's counterpart of IssueMediaToken. The
// grant it names is tenant staff membership, not a purchase or ticket, and it
// is verified only on a console host.
func (m *TokenManager) IssueAdminMediaToken(
	subjectPublicID string,
	tenantID string,
	episodeID string,
	credentialsVersion int32,
	now time.Time,
) (token string, expiresAt time.Time, err error) {
	return m.issueScopedMediaToken(subjectPublicID, tenantID, episodeID, credentialsVersion, now, AudienceAdminMedia)
}

// IssueFreeEpisodeMediaToken creates the media token a free episode's body
// image URLs carry, and the URLs of the pages a priced episode opens as a
// preview. A reader of a free body has no credential to derive an
// image key from, and IssueMediaToken cannot stand in for one: it names a
// reader, and a per-reader token would make every free page URL distinct and
// expire long before the shared, cached episode read that carries it.
//
// So this token names nobody and is a pure function of the tenant, the episode
// and the current rotation window. Two calls inside one window produce the same
// bytes, whichever server made them.
func (m *TokenManager) IssueFreeEpisodeMediaToken(
	tenantID string,
	episodeID string,
	now time.Time,
) (token string, expiresAt time.Time, err error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return "", time.Time{}, errors.New("tenant is required")
	}
	episodeID = strings.TrimSpace(episodeID)
	if episodeID == "" {
		return "", time.Time{}, errors.New("episode is required")
	}
	// Truncate measures from the zero time, which is UTC midnight, so a
	// whole-hour window lands on the same boundary for every process without
	// them agreeing on one.
	windowStart := now.UTC().Truncate(FreeEpisodeMediaTokenWindow)
	return m.sign(AccessTokenClaims{
		TenantID:  tenantID,
		EpisodeID: episodeID,
	}, FreeEpisodeMediaSubject, AudienceMedia, "", FreeEpisodeMediaTokenTTL, windowStart)
}

// IssueMFAChallengeToken creates the short-lived token that stands in for the
// session between a correct password and the second factor. audience picks
// what the challenge may complete: AudienceAdminMFAVerify for an account that
// owes a code, AudienceAdminMFAEnroll for one that owes an enrollment, and
// AudiencePlatformMFAVerify and AudiencePlatformMFAEnroll for an operator of
// the platform console, and AudiencePublicMFAVerify for a reader signing in
// to the site. An admin or a site challenge names its tenant and a platform
// one names none, because an operator belongs to no tenant. It carries no role,
// so nothing that authorizes on one can act on it, and it carries the
// credentials version, so a password change ends it.
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
	tenantID = strings.TrimSpace(tenantID)
	switch strings.TrimSpace(audience) {
	case AudienceAdminMFAVerify, AudienceAdminMFAEnroll, AudiencePublicMFAVerify:
		if tenantID == "" {
			return "", time.Time{}, errors.New("tenant is required")
		}
	case AudiencePlatformMFAVerify, AudiencePlatformMFAEnroll:
		if tenantID != "" {
			return "", time.Time{}, errors.New("a platform challenge names no tenant")
		}
	default:
		return "", time.Time{}, errors.New("audience is not an mfa challenge audience")
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

// IssueLoginDeviceToken signs the token that remembers a device as one a
// password sign-in to subject — the sign-in limit's name for an address within
// its scope — was made from. Its `jti` is what the limit charges that device's
// attempts to, so every token is a device of its own.
func (m *TokenManager) IssueLoginDeviceToken(subject string, now time.Time) (token string, expiresAt time.Time, err error) {
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return "", time.Time{}, errors.New("subject is required")
	}
	tokenID, err := uuid.NewV7()
	if err != nil {
		return "", time.Time{}, err
	}
	return m.sign(AccessTokenClaims{}, subject, AudienceLoginDevice, tokenID.String(), LoginDeviceTTL, now)
}

// VerifyLoginDeviceToken answers the `jti` of token when it is a login device
// token this deployment signed for subject and has not expired, and an error
// otherwise.
func (m *TokenManager) VerifyLoginDeviceToken(token, subject string) (string, error) {
	claims, err := m.Verify(token, AudienceLoginDevice)
	if err != nil {
		return "", err
	}
	if claims.Subject != strings.TrimSpace(subject) {
		return "", errors.New("the device token names another address")
	}
	if strings.TrimSpace(claims.ID) == "" {
		return "", errors.New("the device token names no device")
	}
	return claims.ID, nil
}

// IssueStepUpToken signs the token a tenant console account earns by proving,
// on top of the session sessionID names, that its owner is the one using it.
// It carries the session's subject, tenant, and credentials version too, so
// beside another account's session, another tenant's, or a session from before
// a password change it admits nothing.
func (m *TokenManager) IssueStepUpToken(
	subjectPublicID string,
	tenantID string,
	sessionID uuid.UUID,
	credentialsVersion int32,
	now time.Time,
) (token string, expiresAt time.Time, err error) {
	subjectPublicID = strings.TrimSpace(subjectPublicID)
	if subjectPublicID == "" {
		return "", time.Time{}, errors.New("subject is required")
	}
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return "", time.Time{}, errors.New("tenant is required")
	}
	if sessionID == uuid.Nil {
		return "", time.Time{}, errors.New("session is required")
	}
	return m.sign(AccessTokenClaims{
		TenantID:           tenantID,
		CredentialsVersion: credentialsVersion,
		BoundSessionID:     sessionID.String(),
	}, subjectPublicID, AudienceAdminStepUp, "", StepUpTokenTTL, now)
}

// VerifyStepUpToken reports whether token is a step-up token this deployment
// signed for the session whose claims session holds, and has not expired.
func (m *TokenManager) VerifyStepUpToken(token string, session *AccessTokenClaims) error {
	sessionID, _, ok := session.SessionID()
	if !ok {
		return errors.New("the session has no id to bind a step-up to")
	}
	claims, err := m.Verify(token, AudienceAdminStepUp)
	if err != nil {
		return err
	}
	switch {
	case claims.Subject != session.Subject:
		return errors.New("the step-up token names another account")
	case claims.TenantID != session.TenantID:
		return errors.New("the step-up token names another tenant")
	case claims.BoundSessionID != sessionID.String():
		return errors.New("the step-up token names another session")
	case claims.CredentialsVersion != session.CredentialsVersion:
		return errors.New("the step-up token predates a credentials change")
	}
	return nil
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
// becomes the `jti`: the identifier an MFA challenge is claimed by, the one
// a session is recorded under when it signs out, and the one a login device's
// attempts are charged to. It is empty for a media token, which nothing spends
// or signs out of.
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

// SessionID is the identifier a session is recorded under when it signs out,
// and the expiry the record keeps it for. ok is false for a token issued
// before access tokens carried a `jti`, which nothing can sign out of until it
// expires.
func (c *AccessTokenClaims) SessionID() (id uuid.UUID, expiresAt time.Time, ok bool) {
	if c == nil || c.ID == "" || c.ExpiresAt == nil {
		return uuid.UUID{}, time.Time{}, false
	}
	id, err := uuid.Parse(c.ID)
	if err != nil {
		return uuid.UUID{}, time.Time{}, false
	}
	return id, c.ExpiresAt.Time, true
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
