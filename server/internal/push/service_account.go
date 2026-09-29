package push

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/oauth2/google"
)

// MaxServiceAccountJSONBytes bounds a key file. One Firebase downloads is about
// 2.3 KiB, so anything near this is not one.
const MaxServiceAccountJSONBytes = 16 << 10

// ErrInvalidServiceAccount reports a key [New] could not send with. Its message
// names the field at fault and never repeats a value from the key.
var ErrInvalidServiceAccount = errors.New("push: invalid service account key")

// ServiceAccount is what a service account key says about itself.
type ServiceAccount struct {
	ProjectID   string
	ClientEmail string
}

type serviceAccountKey struct {
	Type        string `json:"type"`
	ProjectID   string `json:"project_id"`
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

// ParseServiceAccount checks that credentialsJSON is a service account key
// with an RSA private key, without asking Google anything. A key that passes
// can still have been revoked; that surfaces on the first send.
func ParseServiceAccount(credentialsJSON []byte) (ServiceAccount, error) {
	if len(credentialsJSON) > MaxServiceAccountJSONBytes {
		return ServiceAccount{}, fmt.Errorf("%w: larger than %d bytes", ErrInvalidServiceAccount, MaxServiceAccountJSONBytes)
	}
	var key serviceAccountKey
	if err := json.Unmarshal(credentialsJSON, &key); err != nil {
		return ServiceAccount{}, fmt.Errorf("%w: not a JSON object", ErrInvalidServiceAccount)
	}
	if key.Type != string(google.ServiceAccount) {
		return ServiceAccount{}, fmt.Errorf("%w: type is not %q", ErrInvalidServiceAccount, google.ServiceAccount)
	}
	projectID := strings.TrimSpace(key.ProjectID)
	if projectID == "" {
		return ServiceAccount{}, fmt.Errorf("%w: project_id is missing", ErrInvalidServiceAccount)
	}
	clientEmail := strings.TrimSpace(key.ClientEmail)
	if clientEmail == "" {
		return ServiceAccount{}, fmt.Errorf("%w: client_email is missing", ErrInvalidServiceAccount)
	}
	if tokenURI := strings.TrimSpace(key.TokenURI); tokenURI != "" && tokenURI != google.JWTTokenURL {
		return ServiceAccount{}, fmt.Errorf("%w: token_uri is not %s", ErrInvalidServiceAccount, google.JWTTokenURL)
	}
	if !isRSAPrivateKey(key.PrivateKey) {
		return ServiceAccount{}, fmt.Errorf("%w: private_key is not a PEM-encoded RSA key", ErrInvalidServiceAccount)
	}
	return ServiceAccount{ProjectID: projectID, ClientEmail: clientEmail}, nil
}

func isRSAPrivateKey(value string) bool {
	block, _ := pem.Decode([]byte(value))
	if block == nil {
		return false
	}
	if parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		_, ok := parsed.(*rsa.PrivateKey)
		return ok
	}
	_, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	return err == nil
}
