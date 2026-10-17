// Package tenantwebauthn is the WebAuthn relying party a tenant's passkeys are
// registered with and asserted against.
//
// The relying party is derived from the tenant row, never from the request:
// the Go API sits behind the Next.js apps and does not see the browser's
// origin, so a value taken from the request would be one the caller chose. A
// tenant has two origins, its storefront and its console, and they are always
// two relying parties: each takes its own host as its RP ID and accepts a
// ceremony from its own origin and no other web origin. A console served
// under the storefront's domain could name the storefront's host as its RP
// ID, but it never does, so a passkey registered on one surface never answers
// the other. The storefront signs a reader in with a password alone, and every
// console account can sign in there too, so a credential the two shared
// would let anyone holding that password register a passkey on the
// storefront and answer the console's second factor with it.
//
// The storefront's passkeys are also used by the tenant's Android app, which
// the storefront's assetlinks.json vouches for. Credential Manager names the
// app rather than the site as the origin of a ceremony the app makes, so the
// storefront also accepts the origin each of the app's saved signing
// certificates produces. iOS needs nothing of the kind: AuthenticationServices
// reports the RP ID's own https origin for an app the site vouches for.
//
// The storefront signs a reader in with a passkey alone, so its credentials
// are discoverable: registration requires a resident key, and a sign-in
// begins with no account named and learns the account from the credential
// the authenticator picks. The console asks for a passkey only as a second
// factor, after a password has named the account, and merely prefers one.
//
// A ceremony's server-side state is a challenge, an RP ID, a user handle, and
// an expiry. The caller stores those between begin and finish and spends them
// once; this package rebuilds the rest of what the library verifies against
// from the same fixed choices it began with.
package tenantwebauthn

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantorigin"
)

// The two ceremonies, as user_webauthn_ceremonies.ceremony names them.
const (
	CeremonyRegistration   = "registration"
	CeremonyAuthentication = "authentication"
)

// The tenant's two relying parties, as the relying_party column of
// user_webauthn_credentials and user_webauthn_ceremonies names them.
const (
	KindAdminConsole = "admin_console"
	KindSite         = "site"
)

// CeremonyTimeout is how long an authenticator is given, and how long the
// server keeps the ceremony after its begin. It matches the five minutes an MFA
// challenge lives, so a ceremony begun under one cannot outlast it by much.
const CeremonyTimeout = 5 * time.Minute

// defaultDisplayName is what an authenticator lists a credential under when
// the tenant has no name of its own to show.
const defaultDisplayName = "Publira"

var (
	// ErrCeremonyMismatch reports a stored ceremony that does not belong to
	// this relying party: begun for another RP ID, or already past its expiry.
	ErrCeremonyMismatch = errors.New("tenantwebauthn: the ceremony does not belong to this relying party")
	// ErrSignCountRegressed reports an assertion whose signature counter did
	// not move past the one stored, which is what a cloned authenticator
	// produces.
	ErrSignCountRegressed = errors.New("tenantwebauthn: the signature counter did not increase")
)

// credentialParameters are the algorithms a registration offers. They are
// fixed rather than left to the library's defaults at each call, because the
// finish rebuilds the session from them and has to name the same list the
// begin sent.
var credentialParameters = webauthn.CredentialParametersDefault()

// RelyingParty is one origin of a tenant, as WebAuthn sees it.
type RelyingParty struct {
	// Kind is which of the tenant's two relying parties this is: KindSite or
	// KindAdminConsole.
	Kind string
	// ID is the RP ID a credential is bound to.
	ID string
	// Origin is the only web origin a ceremony is accepted from.
	Origin   string
	webAuthn *webauthn.WebAuthn
}

// AdminConsole is the relying party of the tenant's console.
func AdminConsole(tenant dbmodels.Tenant) (*RelyingParty, error) {
	console, err := tenantorigin.AdminConsole(tenant)
	if err != nil {
		return nil, err
	}
	return newRelyingParty(tenant, KindAdminConsole, hostname(console), console, nil, protocol.ResidentKeyRequirementPreferred)
}

// Site is the relying party of the tenant's storefront. androidCertFingerprints
// are the SHA-256 fingerprints of the signing certificates of the tenant's
// Android app, as tenant_config.android_sha256_cert_fingerprints keeps them,
// and are empty where the tenant has no Android app.
func Site(tenant dbmodels.Tenant, androidCertFingerprints []string) (*RelyingParty, error) {
	site, err := tenantorigin.Site(tenant)
	if err != nil {
		return nil, err
	}
	appOrigins := make([]string, 0, len(androidCertFingerprints))
	for _, fingerprint := range androidCertFingerprints {
		origin, err := AndroidAppOrigin(fingerprint)
		if err != nil {
			return nil, err
		}
		appOrigins = append(appOrigins, origin)
	}
	return newRelyingParty(tenant, KindSite, hostname(site), site, appOrigins, protocol.ResidentKeyRequirementRequired)
}

// AndroidAppOrigin is the origin Credential Manager reports for a ceremony
// made by an Android app signed with the certificate whose SHA-256
// fingerprint, as colon-separated hex, is fingerprint: the digest itself,
// base64url-encoded without padding, after "android:apk-key-hash:".
func AndroidAppOrigin(fingerprint string) (string, error) {
	digest, err := hex.DecodeString(strings.ReplaceAll(fingerprint, ":", ""))
	if err != nil || len(digest) != sha256.Size {
		return "", fmt.Errorf("tenantwebauthn: %q is not a SHA-256 certificate fingerprint", fingerprint)
	}
	return protocol.OpaqueOriginPrefixAndroidAPKKeyHash + base64.RawURLEncoding.EncodeToString(digest), nil
}

// SiteRPID is the RP ID the storefront's passkeys are bound to: the
// storefront's own host.
func SiteRPID(tenant dbmodels.Tenant) (string, error) {
	site, err := tenantorigin.Site(tenant)
	if err != nil {
		return "", err
	}
	return hostname(site), nil
}

// AdminConsoleRPID is the RP ID the console's passkeys are bound to: the
// console's own host, wherever it is served.
func AdminConsoleRPID(tenant dbmodels.Tenant) (string, error) {
	console, err := tenantorigin.AdminConsole(tenant)
	if err != nil {
		return "", err
	}
	return hostname(console), nil
}

func hostname(origin *url.URL) string {
	return strings.ToLower(origin.Hostname())
}

func newRelyingParty(tenant dbmodels.Tenant, kind, rpID string, origin *url.URL, appOrigins []string, residentKey protocol.ResidentKeyRequirement) (*RelyingParty, error) {
	displayName := strings.TrimSpace(tenant.Name)
	if displayName == "" {
		displayName = defaultDisplayName
	}
	timeout := webauthn.TimeoutConfig{Enforce: true, Timeout: CeremonyTimeout, TimeoutUVD: CeremonyTimeout}
	selection := protocol.AuthenticatorSelection{
		ResidentKey:      residentKey,
		UserVerification: protocol.VerificationRequired,
	}
	// The Level 1 spelling of the same requirement, which a browser that
	// predates residentKey reads instead.
	if residentKey == protocol.ResidentKeyRequirementRequired {
		selection.RequireResidentKey = protocol.ResidentKeyRequired()
	}
	webAuthn, err := webauthn.New(&webauthn.Config{
		RPID:                   rpID,
		RPDisplayName:          displayName,
		RPOrigins:              []string{origin.String()},
		RPOpaqueOrigins:        appOrigins,
		AttestationPreference:  protocol.PreferNoAttestation,
		AuthenticatorSelection: selection,
		Timeouts:               webauthn.TimeoutsConfig{Login: timeout, Registration: timeout},
	})
	if err != nil {
		return nil, fmt.Errorf("tenantwebauthn: relying party %q: %w", rpID, err)
	}
	return &RelyingParty{Kind: kind, ID: rpID, Origin: origin.String(), webAuthn: webAuthn}, nil
}

// User is the account a ceremony is for, with the credentials it holds for
// the relying party at hand.
type User struct {
	Handle      []byte
	Name        string
	DisplayName string
	Credentials []dbmodels.UserWebauthnCredential
}

// UserHandle is the WebAuthn user handle of an account. The public ID is
// stable, carries no personal data, and already names the account outside
// the database, so an authenticator learns nothing from it that a URL would
// not tell it.
func UserHandle(publicID string) []byte {
	return []byte(publicID)
}

func (u User) WebAuthnID() []byte          { return u.Handle }
func (u User) WebAuthnName() string        { return u.Name }
func (u User) WebAuthnDisplayName() string { return u.DisplayName }

func (u User) WebAuthnCredentials() []webauthn.Credential {
	credentials := make([]webauthn.Credential, 0, len(u.Credentials))
	for _, row := range u.Credentials {
		credentials = append(credentials, credentialFromRow(row))
	}
	return credentials
}

func credentialFromRow(row dbmodels.UserWebauthnCredential) webauthn.Credential {
	var flags protocol.AuthenticatorFlags
	if row.BackupEligible {
		flags |= protocol.FlagBackupEligible
	}
	if row.BackedUp {
		flags |= protocol.FlagBackupState
	}
	transports := make([]protocol.AuthenticatorTransport, 0, len(row.Transports))
	for _, transport := range row.Transports {
		transports = append(transports, protocol.AuthenticatorTransport(transport))
	}
	return webauthn.Credential{
		ID:        row.CredentialID,
		PublicKey: row.PublicKey,
		Transport: transports,
		Flags:     webauthn.NewCredentialFlags(flags),
		Authenticator: webauthn.Authenticator{
			AAGUID:    row.Aaguid[:],
			SignCount: uint32(row.SignCount),
		},
	}
}

// Ceremony is what the server keeps of a ceremony between its begin and its
// finish.
type Ceremony struct {
	Challenge string
	RPID      string
	ExpiresAt time.Time
}

// BeginRegistration answers the creation options for user, as the JSON
// PublicKeyCredential.parseCreationOptionsFromJSON reads, together with the
// ceremony to keep. The credentials user already holds are excluded, so an
// authenticator does not register a second credential for the same account.
func (rp *RelyingParty) BeginRegistration(user User) ([]byte, Ceremony, error) {
	exclusions := make([]protocol.CredentialDescriptor, 0, len(user.Credentials))
	for _, credential := range user.WebAuthnCredentials() {
		exclusions = append(exclusions, credential.Descriptor())
	}
	creation, session, err := rp.webAuthn.BeginRegistration(
		user,
		webauthn.WithCredentialParameters(credentialParameters),
		webauthn.WithExclusions(exclusions),
	)
	if err != nil {
		return nil, Ceremony{}, fmt.Errorf("tenantwebauthn: begin registration: %w", err)
	}
	options, err := json.Marshal(creation.Response)
	if err != nil {
		return nil, Ceremony{}, fmt.Errorf("tenantwebauthn: encode creation options: %w", err)
	}
	return options, Ceremony{Challenge: session.Challenge, RPID: rp.ID, ExpiresAt: session.Expires}, nil
}

// BeginAuthentication answers the request options for user, as the JSON
// PublicKeyCredential.parseRequestOptionsFromJSON reads, allowing the
// credentials user holds, together with the ceremony to keep.
func (rp *RelyingParty) BeginAuthentication(user User) ([]byte, Ceremony, error) {
	assertion, session, err := rp.webAuthn.BeginLogin(user)
	if err != nil {
		return nil, Ceremony{}, fmt.Errorf("tenantwebauthn: begin authentication: %w", err)
	}
	options, err := json.Marshal(assertion.Response)
	if err != nil {
		return nil, Ceremony{}, fmt.Errorf("tenantwebauthn: encode request options: %w", err)
	}
	return options, Ceremony{Challenge: session.Challenge, RPID: rp.ID, ExpiresAt: session.Expires}, nil
}

// BeginDiscoverableAuthentication answers request options that name no
// account and allow no credential in particular, so the authenticator offers
// whichever discoverable credential it holds for the RP ID, together with the
// ceremony to keep.
func (rp *RelyingParty) BeginDiscoverableAuthentication() ([]byte, Ceremony, error) {
	assertion, session, err := rp.webAuthn.BeginDiscoverableLogin()
	if err != nil {
		return nil, Ceremony{}, fmt.Errorf("tenantwebauthn: begin discoverable authentication: %w", err)
	}
	options, err := json.Marshal(assertion.Response)
	if err != nil {
		return nil, Ceremony{}, fmt.Errorf("tenantwebauthn: encode request options: %w", err)
	}
	return options, Ceremony{Challenge: session.Challenge, RPID: rp.ID, ExpiresAt: session.Expires}, nil
}

// ParseRegistration reads the PublicKeyCredential an authenticator created,
// as its toJSON() serializes it, and answers the challenge it was made over,
// which is what names the stored ceremony to finish it against.
func ParseRegistration(data []byte) (*protocol.ParsedCredentialCreationData, string, error) {
	parsed, err := protocol.ParseCredentialCreationResponseBytes(data)
	if err != nil {
		return nil, "", err
	}
	return parsed, parsed.Response.CollectedClientData.Challenge, nil
}

// ParseAssertion reads the PublicKeyCredential an authenticator asserted
// with, as its toJSON() serializes it, and answers the challenge it signed.
func ParseAssertion(data []byte) (*protocol.ParsedCredentialAssertionData, string, error) {
	parsed, err := protocol.ParseCredentialRequestResponseBytes(data)
	if err != nil {
		return nil, "", err
	}
	return parsed, parsed.Response.CollectedClientData.Challenge, nil
}

// FinishRegistration verifies a created credential against the ceremony that
// began it, user verification included, and answers the credential to store.
func (rp *RelyingParty) FinishRegistration(user User, ceremony Ceremony, parsed *protocol.ParsedCredentialCreationData) (*webauthn.Credential, error) {
	if err := rp.checkCeremony(ceremony); err != nil {
		return nil, err
	}
	session := webauthn.SessionData{
		Challenge:        ceremony.Challenge,
		RelyingPartyID:   ceremony.RPID,
		UserID:           user.Handle,
		Expires:          ceremony.ExpiresAt,
		UserVerification: protocol.VerificationRequired,
		CredParams:       credentialParameters,
	}
	return rp.webAuthn.CreateCredential(user, session, parsed)
}

// FinishAuthentication verifies an assertion against the ceremony that began
// it and the credentials user holds, user verification included, and answers
// the credential it was made with, its counter and backup state advanced to
// what the assertion reported. A counter that did not advance is
// ErrSignCountRegressed.
func (rp *RelyingParty) FinishAuthentication(user User, ceremony Ceremony, parsed *protocol.ParsedCredentialAssertionData) (*webauthn.Credential, error) {
	if err := rp.checkCeremony(ceremony); err != nil {
		return nil, err
	}
	session := webauthn.SessionData{
		Challenge:        ceremony.Challenge,
		RelyingPartyID:   ceremony.RPID,
		UserID:           user.Handle,
		Expires:          ceremony.ExpiresAt,
		UserVerification: protocol.VerificationRequired,
	}
	credential, err := rp.webAuthn.ValidateLogin(user, session, parsed)
	if err != nil {
		return nil, err
	}
	if credential.Authenticator.CloneWarning {
		return nil, ErrSignCountRegressed
	}
	return credential, nil
}

// DiscoverableUser answers the account a discoverable assertion names: the
// credential its ID identifies, and the account that credential belongs to,
// with every credential that account holds for the relying party. It is
// handed the user handle the authenticator returned, and the account it
// answers has to be the one that handle names, which the verification checks
// against User.Handle.
type DiscoverableUser func(credentialID, userHandle []byte) (User, error)

// FinishDiscoverableAuthentication verifies an assertion made against a
// ceremony begun with no account named. lookup names the account from the
// credential the authenticator picked; the assertion is then verified as
// FinishAuthentication verifies one, user verification and the counter
// included, and with the user handle it returned required to be the
// account's.
func (rp *RelyingParty) FinishDiscoverableAuthentication(ceremony Ceremony, parsed *protocol.ParsedCredentialAssertionData, lookup DiscoverableUser) (*webauthn.Credential, error) {
	if err := rp.checkCeremony(ceremony); err != nil {
		return nil, err
	}
	session := webauthn.SessionData{
		Challenge:        ceremony.Challenge,
		RelyingPartyID:   ceremony.RPID,
		Expires:          ceremony.ExpiresAt,
		UserVerification: protocol.VerificationRequired,
	}
	credential, err := rp.webAuthn.ValidateDiscoverableLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
		return lookup(rawID, userHandle)
	}, session, parsed)
	if err != nil {
		return nil, err
	}
	if credential.Authenticator.CloneWarning {
		return nil, ErrSignCountRegressed
	}
	return credential, nil
}

func (rp *RelyingParty) checkCeremony(ceremony Ceremony) error {
	if ceremony.RPID != rp.ID || !ceremony.ExpiresAt.After(time.Now()) {
		return ErrCeremonyMismatch
	}
	return nil
}

// AAGUID reads the authenticator model a credential reported, or the nil
// UUID for one that reported none.
func AAGUID(credential *webauthn.Credential) uuid.UUID {
	aaguid, err := uuid.FromBytes(credential.Authenticator.AAGUID)
	if err != nil {
		return uuid.Nil
	}
	return aaguid
}

// Transports are the transports a credential reported, as the strings they
// are stored as.
func Transports(credential *webauthn.Credential) []string {
	transports := make([]string, 0, len(credential.Transport))
	for _, transport := range credential.Transport {
		transports = append(transports, string(transport))
	}
	return transports
}
