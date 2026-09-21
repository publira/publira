package testutil

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"testing"
)

// ServiceAccountJSON answers a Google service account key file for projectID,
// with a freshly generated RSA key, shaped the way Firebase downloads one.
func ServiceAccountJSON(t testing.TB, projectID, clientEmail string) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal RSA key: %v", err)
	}
	body, err := json.Marshal(map[string]string{
		"type":           "service_account",
		"project_id":     projectID,
		"private_key_id": "0123456789abcdef",
		"private_key":    string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		"client_email":   clientEmail,
		"client_id":      "100000000000000000000",
		"auth_uri":       "https://accounts.google.com/o/oauth2/auth",
		"token_uri":      "https://oauth2.googleapis.com/token",
	})
	if err != nil {
		t.Fatalf("encode service account key: %v", err)
	}
	return string(body)
}
