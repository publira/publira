// Package inboundemail stores a tenant's inbound email provider, the domain the
// tenant routes to it, and the credential fields that provider declares, and
// names the per-message address a reader's reply is sent to.
//
// Encrypted material never leaves this package except through
// [Store.LoadEnabledSecrets], which is the server-internal read boundary for
// the inbound webhook. Public reads return [PublicConfig] only: provider,
// enabled flag, domain, and per field whether it is stored and its masked
// hint. Callers must not log, persist, or attach the credentials
// LoadEnabledSecrets answers to RPC responses or audit records.
package inboundemail

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/net/idna"

	"github.com/publira/publira/server/internal/publicid"
)

const (
	ActionUpdated = "tenant_inbound_email_settings_updated"
	TargetType    = "inbound_email_config"

	// replyLocalPart is the local part every per-message address starts with,
	// before the "+" that separates the message's public id.
	replyLocalPart = "contact"

	// maxMailboxLength is the longest address a mailbox may have, the bound
	// contact_messages.reply_to_email holds too.
	maxMailboxLength = 254

	// maxDomainLength is the longest inbound domain whose per-message address
	// still fits in a mailbox: the domain follows "contact+", a public id, and
	// "@". It is shorter than the 253 characters DNS allows, and is the width
	// of tenant_inbound_email_config.domain.
	maxDomainLength = maxMailboxLength - len(replyLocalPart) - len("+") - publicid.Length - len("@")
)

var (
	ErrSecretManagerUnavailable = errors.New("secret manager is not configured")
	ErrSecretRequired           = errors.New("secret is required")
	ErrFieldsRequired           = errors.New("every required credential field must be stored when inbound email is enabled")
	ErrDomainRequired           = errors.New("an inbound domain is required when inbound email is enabled")
	ErrInvalidDomain            = errors.New("inbound domain is not a valid domain name")
	ErrInvalidProvider          = errors.New("provider is not registered")
	ErrUnknownField             = errors.New("credential field is not declared by the provider")
	ErrDuplicateField           = errors.New("credential field is updated twice")
	ErrEncryptFailed            = errors.New("failed to encrypt inbound email credential")
	ErrDecryptFailed            = errors.New("failed to decrypt inbound email credential")
	ErrInvalidCiphertext        = errors.New("inbound email credential is not an encrypted envelope")
	ErrSecretMissing            = errors.New("required inbound email credential is not configured")
	ErrNotEnabled               = errors.New("tenant inbound email settings are not enabled")
	ErrProviderUnavailable      = errors.New("stored inbound email provider is not registered")
)

// IsUnavailable reports errors that mean the webhook must not accept mail:
// missing or disabled settings, a provider this build does not register, a
// missing domain or required field, or a decrypt failure. Other errors (for
// example a database outage) are not unavailable in this sense and should
// surface as internal failures.
func IsUnavailable(err error) bool {
	return errors.Is(err, ErrNotEnabled) ||
		errors.Is(err, ErrProviderUnavailable) ||
		errors.Is(err, ErrDomainRequired) ||
		errors.Is(err, ErrDecryptFailed) ||
		errors.Is(err, ErrInvalidCiphertext) ||
		errors.Is(err, ErrSecretMissing) ||
		errors.Is(err, ErrSecretManagerUnavailable)
}

type SecretManager interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

// FieldState is what is stored for one field the provider declares.
type FieldState struct {
	Name       string
	Configured bool
	// Hint is the masked value of a secret field and the value itself of any
	// other, derived when it was stored.
	Hint string
}

// PublicConfig is the non-secret view of a tenant's inbound email settings.
// It is safe to return from APIs and to log.
type PublicConfig struct {
	TenantID uuid.UUID
	// Provider is empty until the tenant saves one.
	Provider string
	Enabled  bool
	// Domain is empty until the tenant saves one.
	Domain string
	// Fields has one entry per field the provider declares, in its order.
	Fields []FieldState
	// Ready is true when the settings are enabled, a domain is stored, and
	// every field the provider requires is stored: only then is mail accepted,
	// and only then does an answer's Reply-To name [ReplyAddress].
	Ready     bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Field answers the state of the field named name.
func (c PublicConfig) Field(name string) (FieldState, bool) {
	for _, field := range c.Fields {
		if field.Name == name {
			return field, true
		}
	}
	return FieldState{}, false
}

// ReplyAddress answers the address a reader's reply to an answer is sent to
// once the settings are ready: the message's own address on the inbound
// domain, so the reply names its message whatever headers the reader's mail
// client keeps.
func (c PublicConfig) ReplyAddress(messagePublicID string) string {
	return replyLocalPart + "+" + messagePublicID + "@" + c.Domain
}

// MessagePublicID answers the public id of the message address names, when it
// is a per-message address on the inbound domain. The local part's prefix and
// the domain are compared in any case, because mail systems may change their
// case; the public id is compared exactly, because public ids are
// case-sensitive.
func (c PublicConfig) MessagePublicID(address string) (string, bool) {
	at := strings.LastIndexByte(address, '@')
	if at < 0 || c.Domain == "" || !strings.EqualFold(address[at+1:], c.Domain) {
		return "", false
	}
	local := address[:at]
	prefix := replyLocalPart + "+"
	if len(local) <= len(prefix) || !strings.EqualFold(local[:len(prefix)], prefix) {
		return "", false
	}
	publicID := local[len(prefix):]
	if len(publicID) > publicid.Length {
		return "", false
	}
	for _, r := range publicID {
		if (r < '0' || r > '9') && (r < 'A' || r > 'Z') && (r < 'a' || r > 'z') {
			return "", false
		}
	}
	return publicID, true
}

// NormalizeDomain answers domain as it is stored: in lower case, without a
// trailing dot, and in its ASCII form when it is an internationalized name. An
// empty domain stays empty. A domain too long for [PublicConfig.ReplyAddress]
// to fit in a mailbox is refused, since a Reply-To over that length is one a
// mail server may refuse and a reader's client cannot answer.
func NormalizeDomain(domain string) (string, error) {
	domain = strings.TrimSuffix(strings.TrimSpace(domain), ".")
	if domain == "" {
		return "", nil
	}
	ascii, err := idna.Lookup.ToASCII(domain)
	if err != nil {
		return "", ErrInvalidDomain
	}
	ascii = strings.ToLower(ascii)
	if len(ascii) > maxDomainLength || !strings.Contains(ascii, ".") {
		return "", ErrInvalidDomain
	}
	for label := range strings.SplitSeq(ascii, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", ErrInvalidDomain
		}
		for _, r := range label {
			if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' {
				return "", ErrInvalidDomain
			}
		}
	}
	return ascii, nil
}
