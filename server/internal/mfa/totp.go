// Package mfa holds the second factor the admin console asks tenant members
// for: a TOTP authenticator (RFC 6238) and the one-time recovery codes that
// stand in for it. The package owns the parameters and the code arithmetic;
// storage, encryption, and the RPCs live in the admin API.
package mfa

import (
	"crypto/subtle"
	"errors"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const (
	// Period, Digits, and the SHA-1 hash are the parameters every mainstream
	// authenticator app assumes when the otpauth URI omits them. Choosing
	// anything else here trades interoperability for no added strength.
	Period = 30
	Digits = 6

	// Skew is how many periods on either side of now a code is still taken
	// for. One period covers ordinary clock drift between a phone and the
	// server, and keeps the code that was on screen when the user started
	// typing usable.
	Skew = 1

	// SecretSize is the number of random bytes behind the base32 secret.
	// RFC 4226 section 4 requires at least 128 bits and recommends 160, which
	// is also the width of the HMAC-SHA1 digest the code is derived from.
	SecretSize = 20

	// MaxFailedAttempts and LockDuration bound guessing at six digits. The
	// count is per account and covers every code the account is asked for:
	// login, disabling the factor, and regenerating recovery codes.
	MaxFailedAttempts = 5
	LockDuration      = 15 * time.Minute
)

// ErrLocked reports that the account has spent MaxFailedAttempts and may not
// present a code again until its lock expires.
var ErrLocked = errors.New("mfa: too many failed attempts")

var validateOpts = totp.ValidateOpts{
	Period:    Period,
	Skew:      0,
	Digits:    otp.DigitsSix,
	Algorithm: otp.AlgorithmSHA1,
}

// Enrollment is what starting an enrollment hands the console: the secret to
// store encrypted and to show for manual entry, and the URI to render as a QR
// code. issuer names the tenant in the authenticator's account list, and
// accountName distinguishes accounts within it.
type Enrollment struct {
	Secret     string
	OTPAuthURI string
}

// GenerateEnrollment draws a new secret and describes it as an otpauth URI.
func GenerateEnrollment(issuer, accountName string) (Enrollment, error) {
	issuer = strings.TrimSpace(issuer)
	accountName = strings.TrimSpace(accountName)
	if issuer == "" {
		return Enrollment{}, errors.New("mfa: issuer is required")
	}
	if accountName == "" {
		return Enrollment{}, errors.New("mfa: account name is required")
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: accountName,
		Period:      Period,
		SecretSize:  SecretSize,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
	if err != nil {
		return Enrollment{}, err
	}
	return Enrollment{Secret: key.Secret(), OTPAuthURI: key.URL()}, nil
}

// ValidateCode reports whether code is the one secret produces at now, within
// Skew periods either way, and returns the time step it matched. The caller
// stores that step: the window is wider than one period, so refusing a step
// that has already been accepted is what keeps an observed code from being
// replayed while it is still inside the window.
func ValidateCode(secret, code string, now time.Time) (step int64, ok bool) {
	secret = strings.TrimSpace(secret)
	code = NormalizeCode(code)
	if secret == "" || len(code) != Digits {
		return 0, false
	}
	for offset := -Skew; offset <= Skew; offset++ {
		at := now.Add(time.Duration(offset) * Period * time.Second)
		expected, err := totp.GenerateCodeCustom(secret, at, validateOpts)
		if err != nil {
			return 0, false
		}
		if subtle.ConstantTimeCompare([]byte(expected), []byte(code)) == 1 {
			return at.Unix() / Period, true
		}
	}
	return 0, false
}

// GenerateCode is the code secret produces at t. It exists for the tests that
// have to present a valid code, and for nothing else.
func GenerateCode(secret string, t time.Time) (string, error) {
	return totp.GenerateCodeCustom(secret, t, validateOpts)
}

// NormalizeCode drops the separators authenticator apps display codes with,
// so a pasted "123 456" is the code it looks like.
func NormalizeCode(code string) string {
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '-' {
			return -1
		}
		return r
	}, strings.TrimSpace(code))
}
