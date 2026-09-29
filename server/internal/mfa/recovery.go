package mfa

import (
	"crypto/rand"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

const (
	// RecoveryCodeCount is how many codes an enrollment hands out. They are
	// shown once, so the batch has to survive being partly lost.
	RecoveryCodeCount = 10

	// recoveryCodeLength is the number of alphabet characters per code, split
	// into two groups for reading aloud and copying by hand. Ten characters
	// out of a 32-symbol alphabet is 50 bits, far past guessing.
	recoveryCodeLength = 10
	recoveryGroupSize  = 5

	// recoveryAlphabet leaves out I, L, O, U, 0, and 1: a code is transcribed
	// off a screen or a printout, and those are the pairs that get confused.
	recoveryAlphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
)

// GenerateRecoveryCodes draws a fresh batch of codes in display form
// ("ABCDE-FGHJK"). They are the only plaintext that will ever exist: the
// caller stores HashRecoveryCode of each and shows these to the account once.
func GenerateRecoveryCodes() ([]string, error) {
	codes := make([]string, 0, RecoveryCodeCount)
	for range RecoveryCodeCount {
		code, err := generateRecoveryCode()
		if err != nil {
			return nil, err
		}
		codes = append(codes, code)
	}
	return codes, nil
}

func generateRecoveryCode() (string, error) {
	var builder strings.Builder
	builder.Grow(recoveryCodeLength + recoveryCodeLength/recoveryGroupSize)
	for i := range recoveryCodeLength {
		if i > 0 && i%recoveryGroupSize == 0 {
			builder.WriteByte('-')
		}
		index, err := randomIndex(len(recoveryAlphabet))
		if err != nil {
			return "", err
		}
		builder.WriteByte(recoveryAlphabet[index])
	}
	return builder.String(), nil
}

// randomIndex returns a uniform index below n, rejecting the tail of the byte
// range that would otherwise make the low values likelier.
func randomIndex(n int) (int, error) {
	limit := 256 - (256 % n)
	buf := make([]byte, 1)
	for {
		if _, err := rand.Read(buf); err != nil {
			return 0, err
		}
		if int(buf[0]) < limit {
			return int(buf[0]) % n, nil
		}
	}
}

// NormalizeRecoveryCode puts a typed code into the form the hash was taken
// of: upper case, with the display separator and any stray spacing removed.
func NormalizeRecoveryCode(code string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '-' || r == ' ':
			return -1
		case r >= 'a' && r <= 'z':
			return r - ('a' - 'A')
		default:
			return r
		}
	}, strings.TrimSpace(code))
}

// HashRecoveryCode hashes a code for storage. bcrypt rather than a plain
// digest because the epic settled on a password hash for these, and the cost
// is paid at most RecoveryCodeCount times on a login that uses one.
func HashRecoveryCode(code string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(NormalizeRecoveryCode(code)), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyRecoveryCode reports whether code is the one storedHash was taken of.
//
// Input that is not the length of a recovery code is refused before the hash
// is computed. A caller checks one submission against every unspent code the
// account holds, so a six-digit authenticator code that failed TOTP
// validation would otherwise cost RecoveryCodeCount bcrypt comparisons on the
// request thread.
func VerifyRecoveryCode(code, storedHash string) bool {
	normalized := NormalizeRecoveryCode(code)
	if len(normalized) != recoveryCodeLength {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(normalized)) == nil
}
