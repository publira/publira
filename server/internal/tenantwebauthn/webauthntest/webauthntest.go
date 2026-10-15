// Package webauthntest is a software authenticator for tests: it answers the
// creation and request options a relying party hands out with the JSON a
// browser's PublicKeyCredential.toJSON() would send back, signed with a P-256
// key of its own and attested with the "none" format.
//
// Every field is the authenticator's state and may be changed between calls,
// which is how a test makes it misbehave: Origin for an assertion made on
// another site, SignCount for a counter that went backwards.
package webauthntest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
)

// AAGUID is the authenticator model this one reports.
var AAGUID = [16]byte{0x70, 0x75, 0x62, 0x6c, 0x69, 0x72, 0x61, 0x2d, 0x74, 0x65, 0x73, 0x74, 0x00, 0x00, 0x00, 0x01}

// Authenticator holds one credential.
type Authenticator struct {
	// Origin is the origin the browser reports the ceremony ran on.
	Origin string
	// RPID is the relying party the credential is scoped to. Register takes
	// it from the options, as an authenticator would.
	RPID         string
	CredentialID []byte
	UserHandle   []byte
	// SignCount is the counter the next assertion reports. Assert advances it
	// first, unless it is zero: an authenticator that keeps no counter reports
	// zero every time.
	SignCount      uint32
	BackupEligible bool
	BackedUp       bool
	// UserVerified is whether the authenticator says it verified the user.
	UserVerified bool
	key          *ecdsa.PrivateKey
}

// New is an authenticator for ceremonies run on origin, with a fresh key and
// credential ID, a counter starting at one, and user verification.
func New(t testing.TB, origin string) *Authenticator {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("webauthntest: generate key: %v", err)
	}
	credentialID := make([]byte, 32)
	if _, err := rand.Read(credentialID); err != nil {
		t.Fatalf("webauthntest: credential id: %v", err)
	}
	return &Authenticator{
		Origin:       origin,
		CredentialID: credentialID,
		SignCount:    1,
		UserVerified: true,
		key:          key,
	}
}

type creationOptions struct {
	Challenge string `json:"challenge"`
	RP        struct {
		ID string `json:"id"`
	} `json:"rp"`
	User struct {
		ID string `json:"id"`
	} `json:"user"`
}

type requestOptions struct {
	Challenge string `json:"challenge"`
	RPID      string `json:"rpId"`
}

// Register answers PublicKeyCredentialCreationOptionsJSON with the credential
// it creates, as PublicKeyCredential.toJSON() serializes it.
func (a *Authenticator) Register(t testing.TB, optionsJSON string) string {
	t.Helper()

	var options creationOptions
	if err := json.Unmarshal([]byte(optionsJSON), &options); err != nil {
		t.Fatalf("webauthntest: read creation options: %v", err)
	}
	a.RPID = options.RP.ID
	handle, err := base64.RawURLEncoding.DecodeString(options.User.ID)
	if err != nil {
		t.Fatalf("webauthntest: read user handle: %v", err)
	}
	a.UserHandle = handle

	clientData := a.clientData(t, "webauthn.create", options.Challenge)
	attested := make([]byte, 0, 16+2+len(a.CredentialID)+128)
	attested = append(attested, AAGUID[:]...)
	attested = binary.BigEndian.AppendUint16(attested, uint16(len(a.CredentialID)))
	attested = append(attested, a.CredentialID...)
	attested = append(attested, a.publicKey(t)...)
	authData := a.authenticatorData(a.flags()|protocol.FlagAttestedCredentialData, a.SignCount, attested)

	attestationObject, err := webauthncbor.Marshal(map[string]any{
		"fmt":      "none",
		"attStmt":  map[string]any{},
		"authData": authData,
	})
	if err != nil {
		t.Fatalf("webauthntest: encode attestation object: %v", err)
	}
	return a.encode(t, map[string]any{
		"attestationObject": base64.RawURLEncoding.EncodeToString(attestationObject),
		"clientDataJSON":    base64.RawURLEncoding.EncodeToString(clientData),
		"transports":        []string{"internal", "hybrid"},
	})
}

// Assert answers PublicKeyCredentialRequestOptionsJSON with an assertion,
// as PublicKeyCredential.toJSON() serializes it.
func (a *Authenticator) Assert(t testing.TB, optionsJSON string) string {
	t.Helper()

	var options requestOptions
	if err := json.Unmarshal([]byte(optionsJSON), &options); err != nil {
		t.Fatalf("webauthntest: read request options: %v", err)
	}
	return a.AssertChallenge(t, options.Challenge)
}

// AssertChallenge answers an assertion over challenge without reading any
// options, for a test that presents a challenge the server never issued.
func (a *Authenticator) AssertChallenge(t testing.TB, challenge string) string {
	t.Helper()

	if a.SignCount != 0 {
		a.SignCount++
	}
	clientData := a.clientData(t, "webauthn.get", challenge)
	authData := a.authenticatorData(a.flags(), a.SignCount, nil)
	clientDataHash := sha256.Sum256(clientData)
	digest := sha256.Sum256(append(append([]byte{}, authData...), clientDataHash[:]...))
	signature, err := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	if err != nil {
		t.Fatalf("webauthntest: sign assertion: %v", err)
	}
	return a.encode(t, map[string]any{
		"authenticatorData": base64.RawURLEncoding.EncodeToString(authData),
		"clientDataJSON":    base64.RawURLEncoding.EncodeToString(clientData),
		"signature":         base64.RawURLEncoding.EncodeToString(signature),
		"userHandle":        base64.RawURLEncoding.EncodeToString(a.UserHandle),
	})
}

func (a *Authenticator) flags() protocol.AuthenticatorFlags {
	flags := protocol.FlagUserPresent
	if a.UserVerified {
		flags |= protocol.FlagUserVerified
	}
	if a.BackupEligible {
		flags |= protocol.FlagBackupEligible
	}
	if a.BackedUp {
		flags |= protocol.FlagBackupState
	}
	return flags
}

func (a *Authenticator) clientData(t testing.TB, ceremony, challenge string) []byte {
	t.Helper()

	data, err := json.Marshal(map[string]any{
		"type":        ceremony,
		"challenge":   challenge,
		"origin":      a.Origin,
		"crossOrigin": false,
	})
	if err != nil {
		t.Fatalf("webauthntest: encode client data: %v", err)
	}
	return data
}

func (a *Authenticator) authenticatorData(flags protocol.AuthenticatorFlags, signCount uint32, attested []byte) []byte {
	rpIDHash := sha256.Sum256([]byte(a.RPID))
	data := make([]byte, 0, 37+len(attested))
	data = append(data, rpIDHash[:]...)
	data = append(data, byte(flags))
	data = binary.BigEndian.AppendUint32(data, signCount)
	return append(data, attested...)
}

func (a *Authenticator) publicKey(t testing.TB) []byte {
	t.Helper()

	data, err := webauthncbor.Marshal(map[int64]any{
		1:  int64(webauthncose.EllipticKey),
		3:  int64(webauthncose.AlgES256),
		-1: int64(webauthncose.P256),
		-2: a.key.X.FillBytes(make([]byte, 32)),
		-3: a.key.Y.FillBytes(make([]byte, 32)),
	})
	if err != nil {
		t.Fatalf("webauthntest: encode public key: %v", err)
	}
	return data
}

func (a *Authenticator) encode(t testing.TB, response map[string]any) string {
	t.Helper()

	id := base64.RawURLEncoding.EncodeToString(a.CredentialID)
	data, err := json.Marshal(map[string]any{
		"id":                      id,
		"rawId":                   id,
		"type":                    "public-key",
		"authenticatorAttachment": "platform",
		"response":                response,
		"clientExtensionResults":  map[string]any{},
	})
	if err != nil {
		t.Fatalf("webauthntest: encode credential: %v", err)
	}
	return string(data)
}
