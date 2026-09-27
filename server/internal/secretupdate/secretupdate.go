// Package secretupdate resolves what a settings save does to a secret it
// stores encrypted: leave it alone, replace it, or clear it.
package secretupdate

import (
	"errors"
	"fmt"
	"strings"
)

// Mode is how a save states its secret, matching the SecretUpdateMode enums of
// publira.admin.v1 and publira.platform.v1.
type Mode int32

const (
	// Unspecified is what a request that says nothing about the secret
	// carries, and it keeps the stored one.
	Unspecified Mode = 0
	Unchanged   Mode = 1
	Replace     Mode = 2
	Clear       Mode = 3
)

// ErrInvalidMode is returned for a value that names none of the modes.
var ErrInvalidMode = errors.New("invalid secret update mode")

// Keeps reports whether the save leaves the stored secret as it is.
func (m Mode) Keeps() bool {
	return m == Unspecified || m == Unchanged
}

// Resolve answers what a save does to the stored secret, as one of Unchanged,
// Replace, or Clear. A replacement holding nothing but whitespace is refused
// with required, the caller's own error naming its secret.
func Resolve(mode Mode, replacement string, required error) (Mode, error) {
	switch {
	case mode.Keeps():
		return Unchanged, nil
	case mode == Replace:
		if strings.TrimSpace(replacement) == "" {
			return Unspecified, required
		}
		return Replace, nil
	case mode == Clear:
		return Clear, nil
	default:
		return Unspecified, fmt.Errorf("%w: %d", ErrInvalidMode, mode)
	}
}

// Decrypter opens a stored secret, and tells one sealed with the primary key
// from one a key rotation still has to re-encrypt.
type Decrypter interface {
	DecryptString(value string) (string, error)
	EncryptedWithPrimary(value string) bool
}

// KeepIfSame is Unchanged for a Replace whose replacement is the secret already
// stored under the primary key, so a save that repeats it leaves the stored
// ciphertext alone. A secret stored under an older key or in the clear is still
// replaced, which is how a rotation re-encrypts it. Every other mode, and a
// stored secret that cannot be opened, is returned as it is.
func KeepIfSame(mode Mode, replacement, storedEncrypted string, d Decrypter) Mode {
	if mode != Replace || storedEncrypted == "" || d == nil || !d.EncryptedWithPrimary(storedEncrypted) {
		return mode
	}
	stored, err := d.DecryptString(storedEncrypted)
	if err != nil || stored != replacement {
		return mode
	}
	return Unchanged
}
