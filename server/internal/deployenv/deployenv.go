// Package deployenv fills in the secrets of a deployment's .env, such as the one
// infra/deploy/compose.yaml reads, so an install starts from values of the
// right shape that no other install shares rather than from ones typed by
// hand.
package deployenv

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"regexp"
)

// Shape is the form a generated value takes.
type Shape int

const (
	// Hex is 32 random bytes as hex. A connection URL carries a database
	// password unescaped, and hex needs no escaping anywhere.
	Hex Shape = iota + 1
	// Base64 is 32 random bytes in standard base64, the length every key and
	// token the processes read is checked against.
	Base64
	// EncryptionKeys is one key of 32 random bytes in base64 under the ID
	// [EncryptionKeyID], the format PUBLIRA_SECRET_ENCRYPTION_KEYS takes.
	EncryptionKeys
	// PrimaryKeyID is [EncryptionKeyID], which names the one key EncryptionKeys
	// generates as the primary.
	PrimaryKeyID
)

// EncryptionKeyID is the ID of the first encryption key of an install.
const EncryptionKeyID = "k1"

// Secret is a variable of the template that is filled with a generated value.
type Secret struct {
	Name  string
	Shape Shape
}

// Secrets are every variable [Fill] generates, in the order infra/deploy's
// .env.example lists them. scripts/check-deploy-compose.sh fails when that file
// gains a secret this list does not hold.
var Secrets = []Secret{
	{"PUBLIRA_POSTGRES_PASSWORD", Hex},
	{"PUBLIRA_PUBLIC_DB_PASSWORD", Hex},
	{"PUBLIRA_ADMIN_DB_PASSWORD", Hex},
	{"PUBLIRA_PLATFORM_DB_PASSWORD", Hex},
	{"PUBLIRA_OUTBOX_DB_PASSWORD", Hex},
	{"PUBLIRA_TICKER_DB_PASSWORD", Hex},
	{"PUBLIRA_CONTENT_STATS_DB_PASSWORD", Hex},
	{"PUBLIRA_SECRET_ENCRYPTION_KEYS", EncryptionKeys},
	{"PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", PrimaryKeyID},
	{"PUBLIRA_AUTH_JWT_SECRET", Base64},
	{"PUBLIRA_WEB_STOREFRONT_AUTH_SECRET", Base64},
	{"PUBLIRA_WEB_ADMIN_AUTH_SECRET", Base64},
	{"PUBLIRA_REVALIDATE_TOKEN", Hex},
	{"PUBLIRA_WEB_SERVICE_TOKEN", Base64},
	{"PUBLIRA_RUSTFS_ACCESS_KEY", Hex},
	{"PUBLIRA_RUSTFS_SECRET_KEY", Hex},
	// Generated although the Platform Console is optional, so turning it on
	// later is a matter of the profile and its URLs.
	{"PUBLIRA_WEB_PLATFORM_AUTH_SECRET", Base64},
}

// keyBytes is how many random bytes every generated value carries.
const keyBytes = 32

// assignment is a line of a .env file that sets a variable.
var assignment = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)=`)

// Fill returns template with every variable in [Secrets] set to a value
// generated from random, and every other line as the template has it. It
// reports the names it filled, in the order the template sets them.
func Fill(template []byte, random io.Reader) ([]byte, []string, error) {
	shapes := make(map[string]Shape, len(Secrets))
	for _, s := range Secrets {
		shapes[s.Name] = s.Shape
	}
	var out bytes.Buffer
	var filled []string
	for line := range bytes.Lines(template) {
		body := bytes.TrimRight(line, "\r\n")
		match := assignment.FindSubmatch(body)
		if match == nil {
			out.Write(line)
			continue
		}
		name := string(match[1])
		shape, ok := shapes[name]
		if !ok {
			out.Write(line)
			continue
		}
		value, err := generate(shape, random)
		if err != nil {
			return nil, nil, fmt.Errorf("generate %s: %w", name, err)
		}
		out.WriteString(name + "=" + value)
		out.Write(line[len(body):])
		filled = append(filled, name)
	}
	return out.Bytes(), filled, nil
}

func generate(shape Shape, random io.Reader) (string, error) {
	if shape == PrimaryKeyID {
		return EncryptionKeyID, nil
	}
	b := make([]byte, keyBytes)
	if _, err := io.ReadFull(random, b); err != nil {
		return "", err
	}
	switch shape {
	case Hex:
		return hex.EncodeToString(b), nil
	case Base64:
		return base64.StdEncoding.EncodeToString(b), nil
	case EncryptionKeys:
		return EncryptionKeyID + ":" + base64.StdEncoding.EncodeToString(b), nil
	default:
		return "", fmt.Errorf("unknown shape %d", shape)
	}
}
