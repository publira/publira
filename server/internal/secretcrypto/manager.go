package secretcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

const (
	envelopePrefix = "enc"
	envelopeV1     = "v1"
	separator      = ":"
)

var (
	ErrEmptyKeySet       = errors.New("secretcrypto: at least one key is required")
	ErrPrimaryKeyMissing = errors.New("secretcrypto: primary key id is required")
	ErrUnknownPrimaryKey = errors.New("secretcrypto: primary key id is not present in key set")
	ErrUnknownKey        = errors.New("secretcrypto: unknown key id")
	ErrInvalidCiphertext = errors.New("secretcrypto: invalid ciphertext envelope")
	ErrDecryptFailed     = errors.New("secretcrypto: decrypt failed")
)

type Manager struct {
	primaryKeyID string
	aeadByKeyID  map[string]cipher.AEAD
}

func NewManager(keys map[string][]byte, primaryKeyID string) (*Manager, error) {
	if len(keys) == 0 {
		return nil, ErrEmptyKeySet
	}
	primaryKeyID = strings.TrimSpace(primaryKeyID)
	if primaryKeyID == "" {
		return nil, ErrPrimaryKeyMissing
	}

	aeadByKeyID := make(map[string]cipher.AEAD, len(keys))
	for keyID, key := range keys {
		trimmedKeyID := strings.TrimSpace(keyID)
		if trimmedKeyID == "" {
			return nil, fmt.Errorf("secretcrypto: key id must not be empty")
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, fmt.Errorf("secretcrypto: key %q is invalid: %w", trimmedKeyID, err)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("secretcrypto: failed to create gcm for key %q: %w", trimmedKeyID, err)
		}
		aeadByKeyID[trimmedKeyID] = aead
	}

	if _, ok := aeadByKeyID[primaryKeyID]; !ok {
		return nil, ErrUnknownPrimaryKey
	}

	return &Manager{
		primaryKeyID: primaryKeyID,
		aeadByKeyID:  aeadByKeyID,
	}, nil
}

func (m *Manager) EncryptString(plaintext string) (string, error) {
	aead := m.aeadByKeyID[m.primaryKeyID]
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("secretcrypto: failed to create nonce: %w", err)
	}

	ciphertext := aead.Seal(nil, nonce, []byte(plaintext), nil)
	return strings.Join([]string{
		envelopePrefix,
		envelopeV1,
		m.primaryKeyID,
		base64.RawURLEncoding.EncodeToString(nonce),
		base64.RawURLEncoding.EncodeToString(ciphertext),
	}, separator), nil
}

func (m *Manager) DecryptString(value string) (string, error) {
	if !IsEncryptedEnvelope(value) {
		return value, nil
	}

	parts := strings.Split(value, separator)
	if len(parts) != 5 {
		return "", ErrInvalidCiphertext
	}
	if parts[0] != envelopePrefix || parts[1] != envelopeV1 {
		return "", ErrInvalidCiphertext
	}

	keyID := parts[2]
	aead, ok := m.aeadByKeyID[keyID]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrUnknownKey, keyID)
	}

	nonce, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return "", ErrInvalidCiphertext
	}
	if len(nonce) != aead.NonceSize() {
		return "", ErrInvalidCiphertext
	}

	ciphertext, err := base64.RawURLEncoding.DecodeString(parts[4])
	if err != nil {
		return "", ErrInvalidCiphertext
	}

	plaintext, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", ErrDecryptFailed
	}
	return string(plaintext), nil
}

func IsEncryptedEnvelope(value string) bool {
	return strings.HasPrefix(value, envelopePrefix+separator+envelopeV1+separator)
}

func (m *Manager) KeyIDs() []string {
	ids := make([]string, 0, len(m.aeadByKeyID))
	for keyID := range m.aeadByKeyID {
		ids = append(ids, keyID)
	}
	sort.Strings(ids)
	return ids
}

func (m *Manager) PrimaryKeyID() string {
	return m.primaryKeyID
}
