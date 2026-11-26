// Package secrethint derives the hint stored beside a sealed secret: what the
// console shows of a saved credential so that an administrator can tell which
// one it is, without the secret being opened to show it. A hint is stored in
// the clear, beside the ciphertext it stands in for, so it is read by everyone
// who may read the setting and kept in every backup of the database; it holds
// only what can be shown to all of them.
package secrethint

import (
	"crypto"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"regexp"
	"strings"
)

const (
	// fill stands in for the masked part of a secret. Its length is fixed,
	// so a hint says nothing about how long the secret is.
	fill = "••••••••"
	// tail is the number of a secret's last characters a hint shows.
	tail = 4
	// minRevealed is the shortest masked part a hint shows the tail of:
	// at most a quarter of it.
	minRevealed = 4 * tail
)

// typePrefix matches the leading marks the providers put on their keys to
// say what kind of key it is: sk_live_, rk_test_, whsec_, whook_, re_. They carry
// nothing of the key itself, and they are what tells a live key from a test
// one at a glance. The rest of a secret is masked whatever it contains,
// underscores included, since a provider's random part may contain them too.
var typePrefix = regexp.MustCompile(`^(?:sk|pk|rk|whsec|whook|re)_(?:live_|test_)?`)

// Mask is the hint of a secret: its type prefix when it starts with one, a
// fixed run of bullets, and its last four characters when what the bullets
// mask is at least four times as long. A secret that is empty or only
// spaces has no hint.
func Mask(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	prefix := typePrefix.FindString(value)
	rest := []rune(value[len(prefix):])
	if len(rest) < minRevealed {
		return prefix + fill
	}
	return prefix + fill + string(rest[len(rest)-tail:])
}

// PrivateKey is the hint of a PEM-encoded PKCS #8 private key: the SHA-256
// fingerprint of its public key, in the form OpenSSH prints one. The public
// key is not secret, and the fingerprint is what `openssl pkey -pubout
// -outform DER | openssl dgst -sha256 -binary | base64` prints for the key
// file, without the trailing "=". It is empty for a value that is not such a
// key.
func PrivateKey(value string) string {
	block, _ := pem.Decode([]byte(strings.TrimSpace(value)))
	if block == nil {
		return ""
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return ""
	}
	signer, ok := key.(crypto.Signer)
	if !ok {
		return ""
	}
	der, err := x509.MarshalPKIXPublicKey(signer.Public())
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(der)
	return "SHA256:" + base64.RawStdEncoding.EncodeToString(sum[:])
}
