// Package appstoretest signs App Store payloads with a certificate chain of
// its own, shaped as Apple's is, so a test can hand the server a transaction
// only a trusted chain could have signed.
package appstoretest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/appstore"
)

var (
	oidReceiptSigner          = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 11, 1}
	oidWorldwideDeveloperCAG6 = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 2, 1}
)

// Signer holds a root, an intermediate, and a leaf, each valid for a day
// around the moment it was made.
type Signer struct {
	root         *x509.Certificate
	intermediate *x509.Certificate
	leaf         *x509.Certificate
	leafKey      *ecdsa.PrivateKey
}

// NewSigner builds a chain whose leaf and intermediate carry Apple's marker
// extensions.
func NewSigner(t testing.TB) *Signer {
	t.Helper()
	return newSigner(t, true)
}

// NewUnmarkedSigner builds the same chain without the marker extensions, as a
// CA other than Apple's would issue it.
func NewUnmarkedSigner(t testing.TB) *Signer {
	t.Helper()
	return newSigner(t, false)
}

func newSigner(t testing.TB, marked bool) *Signer {
	t.Helper()
	rootKey := newKey(t)
	root := issue(t, &x509.Certificate{
		Subject:               pkix.Name{CommonName: "Test Root CA"},
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}, nil, rootKey, rootKey)

	intermediateKey := newKey(t)
	intermediateTemplate := &x509.Certificate{
		Subject:               pkix.Name{CommonName: "Test Intermediate CA"},
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	leafTemplate := &x509.Certificate{
		Subject:  pkix.Name{CommonName: "Test Receipt Signer"},
		KeyUsage: x509.KeyUsageDigitalSignature,
	}
	if marked {
		intermediateTemplate.ExtraExtensions = []pkix.Extension{{Id: oidWorldwideDeveloperCAG6, Value: []byte{0x05, 0x00}}}
		leafTemplate.ExtraExtensions = []pkix.Extension{{Id: oidReceiptSigner, Value: []byte{0x05, 0x00}}}
	}
	intermediate := issue(t, intermediateTemplate, root, intermediateKey, rootKey)
	leafKey := newKey(t)
	leaf := issue(t, leafTemplate, intermediate, leafKey, intermediateKey)
	return &Signer{root: root, intermediate: intermediate, leaf: leaf, leafKey: leafKey}
}

// Verifier trusts this signer's root and nothing else.
func (s *Signer) Verifier() *appstore.Verifier {
	roots := x509.NewCertPool()
	roots.AddCert(s.root)
	return appstore.NewVerifierWithRoots(roots, time.Now)
}

// Sign answers payload as a compact JWS carrying this signer's chain.
func (s *Signer) Sign(t testing.TB, payload any) string {
	t.Helper()
	header, err := json.Marshal(map[string]any{
		"alg": "ES256",
		"x5c": []string{
			base64.StdEncoding.EncodeToString(s.leaf.Raw),
			base64.StdEncoding.EncodeToString(s.intermediate.Raw),
			base64.StdEncoding.EncodeToString(s.root.Raw),
		},
	})
	if err != nil {
		t.Fatalf("encode JWS header: %v", err)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode JWS payload: %v", err)
	}
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)
	digest := sha256.Sum256([]byte(input))
	r, sig, err := ecdsa.Sign(rand.Reader, s.leafKey, digest[:])
	if err != nil {
		t.Fatalf("sign JWS: %v", err)
	}
	signature := make([]byte, 64)
	r.FillBytes(signature[:32])
	sig.FillBytes(signature[32:])
	return input + "." + base64.RawURLEncoding.EncodeToString(signature)
}

// Transaction is a JWSTransactionDecodedPayload with the fields a test sets.
type Transaction struct {
	TransactionID         string `json:"transactionId"`
	OriginalTransactionID string `json:"originalTransactionId"`
	BundleID              string `json:"bundleId"`
	ProductID             string `json:"productId"`
	Type                  string `json:"type"`
	AppAccountToken       string `json:"appAccountToken,omitempty"`
	Environment           string `json:"environment"`
	PurchaseDate          int64  `json:"purchaseDate"`
	SignedDate            int64  `json:"signedDate"`
	RevocationDate        int64  `json:"revocationDate,omitempty"`
}

// PrivateKeyPEM answers a fresh App Store Connect API key in the .p8 form a
// tenant uploads.
func PrivateKeyPEM(t testing.TB) string {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(newKey(t))
	if err != nil {
		t.Fatalf("marshal API key: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func newKey(t testing.TB) *ecdsa.PrivateKey {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return key
}

func issue(t testing.TB, template, parent *x509.Certificate, key, parentKey *ecdsa.PrivateKey) *x509.Certificate {
	t.Helper()
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 62))
	if err != nil {
		t.Fatalf("draw serial number: %v", err)
	}
	template.SerialNumber = serial
	template.NotBefore = time.Now().Add(-12 * time.Hour)
	template.NotAfter = time.Now().Add(12 * time.Hour)
	if parent == nil {
		parent = template
	}
	der, err := x509.CreateCertificate(rand.Reader, template, parent, &key.PublicKey, parentKey)
	if err != nil {
		t.Fatalf("issue certificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	return cert
}

// Notification is a responseBodyV2DecodedPayload with the fields a test sets.
type Notification struct {
	NotificationType string           `json:"notificationType"`
	Subtype          string           `json:"subtype,omitempty"`
	NotificationUUID string           `json:"notificationUUID"`
	Version          string           `json:"version"`
	SignedDate       int64            `json:"signedDate"`
	Data             NotificationData `json:"data"`
}

// NotificationData is the data object of a notification.
type NotificationData struct {
	BundleID              string `json:"bundleId"`
	Environment           string `json:"environment"`
	SignedTransactionInfo string `json:"signedTransactionInfo,omitempty"`
}
