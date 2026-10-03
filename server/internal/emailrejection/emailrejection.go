// Package emailrejection holds the email addresses a tenant refuses at reader
// sign-up and at a reader's email change: the disposable-domain list the
// platform policy names, which the tenant switches on, and the addresses and
// domains the tenant lists itself.
//
// An entry with an @ is an address and any other is a domain. A domain entry
// refuses the domain and every subdomain of it. An address entry is compared
// after the sub-address tag, the + and whatever follows it in the local part,
// is dropped from both the entry and the address being checked, so a refused
// mailbox cannot come back with a tag added. The tag is dropped for the
// comparison only: the address a reader signs up with is stored and mailed as
// typed. Provider-specific rules, such as Gmail ignoring dots, are not applied.
package emailrejection

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/net/idna"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/disposabledomains"
)

const (
	// MaxEntries bounds the tenant's own list. Every sign-up reads the whole
	// list, and a list a tenant curates by hand to name an abusive address or
	// a domain it will not serve stays far below this.
	MaxEntries = 1000
	// maxEntryLength is the longest address SMTP carries, and so the longest
	// entry that could ever match one.
	maxEntryLength = 254
	// maxLocalLength is the longest local part SMTP carries.
	maxLocalLength = 64

	// ActionSettingsUpdated is the audit action of a change to the settings.
	ActionSettingsUpdated = "tenant_email_rejection_settings_updated"
)

var (
	// ErrInvalidEntry refuses an entry that is neither an address nor a domain
	// of two labels or more.
	ErrInvalidEntry = errors.New("an entry must be an email address or a domain")
	// ErrTooManyEntries refuses a list longer than MaxEntries.
	ErrTooManyEntries = fmt.Errorf("at most %d entries may be listed", MaxEntries)
)

// Settings is what a tenant refuses.
type Settings struct {
	// RejectDisposableDomains applies the disposable-domain list the platform
	// policy names. It refuses nothing on a platform that names none.
	RejectDisposableDomains bool
	// Entries are the addresses and domains the tenant refuses, normalized by
	// NormalizeEntries and in lexical order.
	Entries []string
}

// Verdict is what Check found an address to be.
type Verdict int

const (
	// Accepted is an address the tenant does not refuse.
	Accepted Verdict = iota
	// Listed is an address that matches one of the tenant's own entries.
	Listed
	// Disposable is an address on a domain the disposable-domain list names,
	// for a tenant that has the list switched on.
	Disposable
)

// Querier reads the settings.
type Querier interface {
	GetTenantEmailRejectionSettings(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantEmailRejectionSetting, error)
	ListTenantEmailRejectionEntries(ctx context.Context, tenantID uuid.UUID) ([]string, error)
}

// Writer writes the settings. Update issues several statements, so it is
// handed the querier of a transaction.
type Writer interface {
	Querier
	UpsertTenantEmailRejectionSettings(ctx context.Context, arg dbmodels.UpsertTenantEmailRejectionSettingsParams) (dbmodels.TenantEmailRejectionSetting, error)
	DeleteTenantEmailRejectionEntries(ctx context.Context, tenantID uuid.UUID) error
	InsertTenantEmailRejectionEntries(ctx context.Context, arg dbmodels.InsertTenantEmailRejectionEntriesParams) error
}

// DisposableList answers whether a domain is disposable;
// *disposabledomains.List is the one the server uses.
type DisposableList interface {
	IsDisposable(ctx context.Context, domain string) (bool, error)
}

// Get reads the tenant's settings. A tenant that has saved nothing refuses
// nothing.
func Get(ctx context.Context, q Querier, tenantID uuid.UUID) (Settings, error) {
	var settings Settings
	row, err := q.GetTenantEmailRejectionSettings(ctx, tenantID)
	switch {
	case err == nil:
		settings.RejectDisposableDomains = row.RejectDisposableDomains
	case !errors.Is(err, sql.ErrNoRows):
		return Settings{}, fmt.Errorf("read the email rejection settings: %w", err)
	}
	entries, err := q.ListTenantEmailRejectionEntries(ctx, tenantID)
	if err != nil {
		return Settings{}, fmt.Errorf("read the email rejection entries: %w", err)
	}
	settings.Entries = entries
	return settings, nil
}

// Update replaces the tenant's settings with settings, whose entries it
// normalizes first, and answers what it stored.
func Update(ctx context.Context, q Writer, tenantID uuid.UUID, settings Settings) (Settings, error) {
	entries, err := NormalizeEntries(settings.Entries)
	if err != nil {
		return Settings{}, err
	}
	row, err := q.UpsertTenantEmailRejectionSettings(ctx, dbmodels.UpsertTenantEmailRejectionSettingsParams{
		TenantID:                tenantID,
		RejectDisposableDomains: settings.RejectDisposableDomains,
	})
	if err != nil {
		return Settings{}, fmt.Errorf("write the email rejection settings: %w", err)
	}
	if err := q.DeleteTenantEmailRejectionEntries(ctx, tenantID); err != nil {
		return Settings{}, fmt.Errorf("clear the email rejection entries: %w", err)
	}
	if len(entries) > 0 {
		if err := q.InsertTenantEmailRejectionEntries(ctx, dbmodels.InsertTenantEmailRejectionEntriesParams{
			TenantID: tenantID,
			Entries:  entries,
		}); err != nil {
			return Settings{}, fmt.Errorf("write the email rejection entries: %w", err)
		}
	}
	return Settings{RejectDisposableDomains: row.RejectDisposableDomains, Entries: entries}, nil
}

// Check answers whether the tenant refuses address, which must be a bare
// address as mail.ParseAddress answers it. The tenant's own entries are
// checked first, and the disposable-domain list only while the tenant has it
// switched on.
func Check(ctx context.Context, q Querier, list DisposableList, tenantID uuid.UUID, address string) (Verdict, error) {
	settings, err := Get(ctx, q, tenantID)
	if err != nil {
		return Accepted, err
	}
	if Matches(settings.Entries, address) {
		return Listed, nil
	}
	if !settings.RejectDisposableDomains || list == nil {
		return Accepted, nil
	}
	_, domain, ok := cutAddress(address)
	if !ok {
		return Accepted, nil
	}
	disposable, err := list.IsDisposable(ctx, domain)
	if err != nil {
		return Accepted, fmt.Errorf("look up the disposable-domain list: %w", err)
	}
	if disposable {
		return Disposable, nil
	}
	return Accepted, nil
}

// Matches reports whether address matches one of entries, which are
// normalized as NormalizeEntries leaves them.
func Matches(entries []string, address string) bool {
	local, domain, ok := cutAddress(strings.ToLower(address))
	if !ok {
		return false
	}
	mailbox := dropTag(local)
	host := asciiDomain(domain)
	for _, entry := range entries {
		if entryLocal, entryDomain, isAddress := cutAddress(entry); isAddress {
			if dropTag(entryLocal) == mailbox && asciiDomain(entryDomain) == host {
				return true
			}
			continue
		}
		listed := asciiDomain(entry)
		if host == listed || strings.HasSuffix(host, "."+listed) {
			return true
		}
	}
	return false
}

// NormalizeEntries trims and lowercases each entry, writes a domain in its
// canonical Unicode form, drops blank lines and duplicates, and sorts what is
// left. An entry that is neither an address nor a domain is an
// *InvalidEntryError.
func NormalizeEntries(raw []string) ([]string, error) {
	entries := make([]string, 0, len(raw))
	for _, value := range raw {
		if strings.TrimSpace(value) == "" {
			continue
		}
		entry, err := normalizeEntry(value)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	slices.Sort(entries)
	entries = slices.Compact(entries)
	if len(entries) > MaxEntries {
		return nil, ErrTooManyEntries
	}
	return entries, nil
}

// InvalidEntryError names the entry NormalizeEntries refused.
type InvalidEntryError struct {
	Entry string
}

func (e *InvalidEntryError) Error() string {
	return fmt.Sprintf("%s: %q", ErrInvalidEntry, e.Entry)
}

func (e *InvalidEntryError) Unwrap() error {
	return ErrInvalidEntry
}

func normalizeEntry(raw string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	invalid := &InvalidEntryError{Entry: strings.TrimSpace(raw)}
	var entry string
	if local, domain, isAddress := cutAddress(value); isAddress {
		host, ok := canonicalDomain(domain)
		if !ok || !validLocal(local) {
			return "", invalid
		}
		entry = local + "@" + host
	} else {
		host, ok := canonicalDomain(value)
		if !ok {
			return "", invalid
		}
		entry = host
	}
	if len(entry) > maxEntryLength {
		return "", invalid
	}
	return entry, nil
}

// cutAddress splits an address at its last @. A quoted local part may hold an
// @ of its own, and mail.ParseAddress accepts one, so the domain is what
// follows the last: splitting at the first would leave a domain no rule
// matches and let such an address past every one of them.
func cutAddress(address string) (local, domain string, ok bool) {
	at := strings.LastIndexByte(address, '@')
	if at < 0 {
		return "", "", false
	}
	return address[:at], address[at+1:], true
}

// dropTag drops the sub-address tag from a local part.
func dropTag(local string) string {
	mailbox, _, _ := strings.Cut(local, "+")
	return mailbox
}

// validLocal accepts a local part written as a dot-atom: atext characters, or
// any non-ASCII character, separated by single dots. A local part that is only
// a tag names no mailbox, so it is refused as well.
func validLocal(local string) bool {
	if local == "" || len(local) > maxLocalLength || !utf8.ValidString(local) {
		return false
	}
	if strings.HasPrefix(local, "+") {
		return false
	}
	for atom := range strings.SplitSeq(local, ".") {
		if atom == "" {
			return false
		}
		for _, r := range atom {
			if r >= utf8.RuneSelf {
				continue
			}
			if !isAtext(byte(r)) {
				return false
			}
		}
	}
	return true
}

func isAtext(c byte) bool {
	switch {
	case 'a' <= c && c <= 'z', 'A' <= c && c <= 'Z', '0' <= c && c <= '9':
		return true
	}
	return strings.IndexByte("!#$%&'*+-/=?^_`{|}~", c) >= 0
}

// canonicalDomain answers a domain in the Unicode form IDNA maps it to, or
// false when it is not a domain of two labels or more.
func canonicalDomain(domain string) (string, bool) {
	ascii, err := idna.Lookup.ToASCII(strings.TrimSuffix(domain, "."))
	if err != nil || !disposabledomains.IsDomain(ascii) {
		return "", false
	}
	unicode, err := idna.Lookup.ToUnicode(ascii)
	if err != nil {
		return "", false
	}
	return unicode, true
}

// asciiDomain answers the ASCII form of a domain the comparison runs on, so a
// domain typed in Unicode matches the same domain written in Punycode.
func asciiDomain(domain string) string {
	domain = strings.TrimSuffix(domain, ".")
	if ascii, err := idna.Lookup.ToASCII(domain); err == nil {
		return ascii
	}
	return domain
}
