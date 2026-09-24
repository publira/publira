// Package appstore verifies what the App Store signs and asks the App Store
// Server API about a tenant's transactions.
//
// Everything Apple signs for a transaction is a JWS whose x5c header carries
// the certificate chain it was signed with. The chain is trusted only when it
// ends at Apple Root CA - G3, which this package embeds, and when its leaf and
// intermediate carry the extensions Apple marks them with; a chain any other
// CA issued signs nothing here.
package appstore

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	_ "embed"
)

// Environment values a transaction names.
const (
	EnvironmentProduction = "Production"
	EnvironmentSandbox    = "Sandbox"
)

// TypeConsumable is the product type of an episode's price tier.
const TypeConsumable = "Consumable"

var (
	// ErrInvalidSignature reports a JWS whose signature or certificate chain
	// does not verify against Apple's root.
	ErrInvalidSignature = errors.New("appstore: signature does not verify")
	// ErrMalformed reports a JWS that verifies but cannot be read as a
	// transaction.
	ErrMalformed = errors.New("appstore: signed payload is malformed")
)

// appleRootCAG3 is AppleRootCA-G3.cer as Apple publishes it at
// https://www.apple.com/certificateauthority/, in DER, whose SHA-256
// fingerprint is 63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179.
//
//go:embed AppleRootCA-G3.cer
var appleRootCAG3 []byte

// Marker extensions Apple puts on the certificates that sign App Store
// payloads: the leaf's names the App Store receipt signer, and the
// intermediate's the Apple Worldwide Developer Relations CA - G6.
var (
	oidReceiptSigner          = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 11, 1}
	oidWorldwideDeveloperCAG6 = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 2, 1}
)

// Transaction is the part of a JWSTransactionDecodedPayload a purchase is
// decided on.
type Transaction struct {
	TransactionID         string `json:"transactionId"`
	OriginalTransactionID string `json:"originalTransactionId"`
	BundleID              string `json:"bundleId"`
	ProductID             string `json:"productId"`
	Type                  string `json:"type"`
	// AppAccountToken is the UUID the app set on the purchase, which is the
	// intent the purchase was opened with.
	AppAccountToken string `json:"appAccountToken"`
	Environment     string `json:"environment"`
	// RevocationDate is when Apple refunded or revoked the transaction, in
	// milliseconds since the epoch; zero while it stands.
	RevocationDate int64 `json:"revocationDate"`
}

// Verifier checks the JWS payloads the App Store signs.
type Verifier struct {
	roots *x509.CertPool
	now   func() time.Time
}

// NewVerifier trusts Apple Root CA - G3 alone.
func NewVerifier() *Verifier {
	root, err := x509.ParseCertificate(appleRootCAG3)
	if err != nil {
		panic("appstore: the embedded Apple root certificate does not parse")
	}
	roots := x509.NewCertPool()
	roots.AddCert(root)
	return NewVerifierWithRoots(roots, time.Now)
}

// NewVerifierWithRoots trusts roots instead of Apple's, which is how a test
// verifies a payload it signed itself. now is the instant the chain has to be
// valid at.
func NewVerifierWithRoots(roots *x509.CertPool, now func() time.Time) *Verifier {
	return &Verifier{roots: roots, now: now}
}

// VerifyTransaction checks a JWSTransaction and reads it.
func (v *Verifier) VerifyTransaction(signed string) (Transaction, error) {
	payload, err := v.verify(signed)
	if err != nil {
		return Transaction{}, err
	}
	var transaction Transaction
	if err := json.Unmarshal(payload, &transaction); err != nil {
		return Transaction{}, fmt.Errorf("%w: %v", ErrMalformed, err)
	}
	if transaction.TransactionID == "" || transaction.BundleID == "" || transaction.ProductID == "" {
		return Transaction{}, fmt.Errorf("%w: transaction names no transaction, bundle, or product", ErrMalformed)
	}
	return transaction, nil
}

type jwsHeader struct {
	Alg string   `json:"alg"`
	X5C []string `json:"x5c"`
}

// verify answers the payload of a compact JWS once its chain and its ES256
// signature both verify.
func (v *Verifier) verify(signed string) ([]byte, error) {
	parts := strings.Split(strings.TrimSpace(signed), ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("%w: not a compact JWS", ErrInvalidSignature)
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("%w: header is not base64url", ErrInvalidSignature)
	}
	var header jwsHeader
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil, fmt.Errorf("%w: header is not JSON", ErrInvalidSignature)
	}
	if header.Alg != "ES256" {
		return nil, fmt.Errorf("%w: algorithm %q", ErrInvalidSignature, header.Alg)
	}
	leaf, err := v.verifyChain(header.X5C)
	if err != nil {
		return nil, err
	}
	key, ok := leaf.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("%w: leaf key is not ECDSA", ErrInvalidSignature)
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(signature) != 64 {
		return nil, fmt.Errorf("%w: signature is not a P-256 r||s pair", ErrInvalidSignature)
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r := new(big.Int).SetBytes(signature[:32])
	s := new(big.Int).SetBytes(signature[32:])
	if !ecdsa.Verify(key, digest[:], r, s) {
		return nil, ErrInvalidSignature
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("%w: payload is not base64url", ErrMalformed)
	}
	return payload, nil
}

// verifyChain answers the leaf of an x5c chain that reaches a trusted root
// through an intermediate, each carrying Apple's marker extension.
func (v *Verifier) verifyChain(x5c []string) (*x509.Certificate, error) {
	if len(x5c) < 2 {
		return nil, fmt.Errorf("%w: x5c holds no intermediate", ErrInvalidSignature)
	}
	certs := make([]*x509.Certificate, 0, len(x5c))
	for _, encoded := range x5c {
		der, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("%w: x5c entry is not base64", ErrInvalidSignature)
		}
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, fmt.Errorf("%w: x5c entry is not a certificate", ErrInvalidSignature)
		}
		certs = append(certs, cert)
	}
	leaf, intermediate := certs[0], certs[1]
	if !hasExtension(leaf, oidReceiptSigner) || !hasExtension(intermediate, oidWorldwideDeveloperCAG6) {
		return nil, fmt.Errorf("%w: chain lacks Apple's marker extensions", ErrInvalidSignature)
	}
	intermediates := x509.NewCertPool()
	intermediates.AddCert(intermediate)
	chains, err := leaf.Verify(x509.VerifyOptions{
		Roots:         v.roots,
		Intermediates: intermediates,
		CurrentTime:   v.now(),
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidSignature, err)
	}
	// The marker was checked on x5c[1], so the chain that verified has to run
	// through that certificate rather than another the pool could offer.
	for _, chain := range chains {
		if len(chain) == 3 && bytes.Equal(chain[1].Raw, intermediate.Raw) {
			return leaf, nil
		}
	}
	return nil, fmt.Errorf("%w: chain does not run through its intermediate", ErrInvalidSignature)
}

func hasExtension(cert *x509.Certificate, oid asn1.ObjectIdentifier) bool {
	for _, extension := range cert.Extensions {
		if extension.Id.Equal(oid) {
			return true
		}
	}
	return false
}
