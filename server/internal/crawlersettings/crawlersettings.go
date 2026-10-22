// Package crawlersettings holds the crawlers and paths a tenant's robots.txt
// excludes: the crawlers chosen from the fixed list in [Known], each refused
// every path, and the paths the tenant types, each refused to every crawler.
//
// Both lists are validated here so that whatever is stored can be written into
// robots.txt as it is. A crawler is named by a token from [Known] rather than
// by what a tenant typed, so no User-agent line can carry a value that breaks
// the file. A path is a literal path rather than a robots.txt pattern, because
// the storefront writes each one with the variants that also cover what lies
// under it, and it may not shut crawlers out of the file itself or of the
// sitemap it names.
package crawlersettings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

const (
	// MaxPaths bounds the tenant's path list. The storefront writes every path
	// once per locale prefix and in several variants, so the list is kept to
	// what a tenant curates by hand.
	MaxPaths = 100
	// MaxPathLength is the longest path, in bytes, the list accepts.
	MaxPathLength = 512

	// ActionSettingsUpdated is the audit action of a change to the settings.
	ActionSettingsUpdated = "tenant_crawler_settings_updated"
	// AuditTargetType is the audit target type of a change to the settings.
	AuditTargetType = "tenant_crawler_settings"
)

// Purpose is what a known crawler fetches pages for.
type Purpose int

const (
	// PurposeAITraining collects pages to train AI models on.
	PurposeAITraining Purpose = iota + 1
	// PurposeAIAssistant fetches pages for an AI assistant's answers or for
	// its search results.
	PurposeAIAssistant
	// PurposeImageSearch indexes images for an image search.
	PurposeImageSearch
)

// Crawler is a crawler a tenant may exclude.
type Crawler struct {
	// UserAgent is the token robots.txt names the crawler by, spelled as its
	// operator documents it.
	UserAgent string
	// Operator is the organization that runs the crawler.
	Operator string
	Purpose  Purpose
}

// known is every crawler a tenant may exclude, grouped by purpose. A crawler
// joins only when its operator documents a robots.txt token it honours, since
// a group naming one that ignores the file would promise the tenant an
// exclusion nothing carries out.
var known = []Crawler{
	{UserAgent: "GPTBot", Operator: "OpenAI", Purpose: PurposeAITraining},
	{UserAgent: "ClaudeBot", Operator: "Anthropic", Purpose: PurposeAITraining},
	{UserAgent: "Google-Extended", Operator: "Google", Purpose: PurposeAITraining},
	{UserAgent: "Applebot-Extended", Operator: "Apple", Purpose: PurposeAITraining},
	{UserAgent: "meta-externalagent", Operator: "Meta", Purpose: PurposeAITraining},
	{UserAgent: "CCBot", Operator: "Common Crawl", Purpose: PurposeAITraining},
	{UserAgent: "Bytespider", Operator: "ByteDance", Purpose: PurposeAITraining},
	{UserAgent: "Amazonbot", Operator: "Amazon", Purpose: PurposeAITraining},
	{UserAgent: "OAI-SearchBot", Operator: "OpenAI", Purpose: PurposeAIAssistant},
	{UserAgent: "Claude-SearchBot", Operator: "Anthropic", Purpose: PurposeAIAssistant},
	{UserAgent: "Claude-User", Operator: "Anthropic", Purpose: PurposeAIAssistant},
	{UserAgent: "PerplexityBot", Operator: "Perplexity", Purpose: PurposeAIAssistant},
	{UserAgent: "Googlebot-Image", Operator: "Google", Purpose: PurposeImageSearch},
}

// Known answers every crawler a tenant may exclude, grouped by purpose.
func Known() []Crawler {
	return slices.Clone(known)
}

// reservedPaths are the files robots.txt may never shut crawlers out of: the
// file itself and the sitemap index it names.
var reservedPaths = []string{"/robots.txt", "/sitemap.xml"}

// reservedPrefix is the directory the sitemap index points into. A path is
// refused as the directory itself and as anything under it.
const reservedPrefix = "/sitemap"

var (
	// ErrUnknownUserAgent refuses a user agent that is not a token in Known.
	ErrUnknownUserAgent = errors.New("user agent must be one of the known crawlers")
	// ErrInvalidPath refuses a path that does not start with / or holds a
	// character robots.txt reads as something other than a path.
	ErrInvalidPath = errors.New("path must start with / and hold no whitespace, control character, *, $, ?, or #")
	// ErrPathTooLong refuses a path longer than MaxPathLength.
	ErrPathTooLong = fmt.Errorf("path must be at most %d bytes", MaxPathLength)
	// ErrReservedPath refuses a path that would shut crawlers out of
	// robots.txt or the sitemap.
	ErrReservedPath = errors.New("path may not name /robots.txt, /sitemap.xml, or /sitemap")
	// ErrTooManyPaths refuses a path list longer than MaxPaths.
	ErrTooManyPaths = fmt.Errorf("at most %d paths may be listed", MaxPaths)
)

// EntryError is a refused entry of one of the lists.
type EntryError struct {
	// List is "excluded_user_agents" or "excluded_paths".
	List string
	// Index is the position of the refused entry in the list sent, or -1
	// where the list as a whole is refused.
	Index int
	Err   error
}

func (e *EntryError) Error() string { return e.Err.Error() }

func (e *EntryError) Unwrap() error { return e.Err }

// Field names the refused entry within the settings, as settings.<list>[i].
func (e *EntryError) Field() string {
	if e.Index < 0 {
		return "settings." + e.List
	}
	return fmt.Sprintf("settings.%s[%d]", e.List, e.Index)
}

// Settings is what a tenant's robots.txt excludes.
type Settings struct {
	// UserAgents are tokens from Known, in Known's order.
	UserAgents []string
	// Paths are normalized by Normalize and in lexical order.
	Paths []string
}

// Equal reports whether s and other exclude the same crawlers and paths.
func (s Settings) Equal(other Settings) bool {
	return slices.Equal(s.UserAgents, other.UserAgents) && slices.Equal(s.Paths, other.Paths)
}

// Normalize validates settings and answers them as they are stored: the user
// agents in Known's order and the paths trimmed, without a trailing /, and in
// lexical order, both without duplicates. A refused entry is an *EntryError.
func Normalize(settings Settings) (Settings, error) {
	userAgents, err := normalizeUserAgents(settings.UserAgents)
	if err != nil {
		return Settings{}, err
	}
	paths, err := normalizePaths(settings.Paths)
	if err != nil {
		return Settings{}, err
	}
	return Settings{UserAgents: userAgents, Paths: paths}, nil
}

func normalizeUserAgents(raw []string) ([]string, error) {
	selected := make(map[string]struct{}, len(raw))
	for i, userAgent := range raw {
		if !slices.ContainsFunc(known, func(c Crawler) bool { return c.UserAgent == userAgent }) {
			return nil, &EntryError{List: "excluded_user_agents", Index: i, Err: ErrUnknownUserAgent}
		}
		selected[userAgent] = struct{}{}
	}
	return knownOrder(selected), nil
}

// knownOrder answers the selected tokens in Known's order, leaving out any
// that Known no longer names.
func knownOrder(selected map[string]struct{}) []string {
	userAgents := make([]string, 0, len(selected))
	for _, crawler := range known {
		if _, ok := selected[crawler.UserAgent]; ok {
			userAgents = append(userAgents, crawler.UserAgent)
		}
	}
	return userAgents
}

func normalizePaths(raw []string) ([]string, error) {
	paths := make([]string, 0, len(raw))
	for i, value := range raw {
		path, err := normalizePath(value)
		if err != nil {
			return nil, &EntryError{List: "excluded_paths", Index: i, Err: err}
		}
		paths = append(paths, path)
	}
	slices.Sort(paths)
	paths = slices.Compact(paths)
	if len(paths) > MaxPaths {
		return nil, &EntryError{List: "excluded_paths", Index: -1, Err: ErrTooManyPaths}
	}
	return paths, nil
}

func normalizePath(value string) (string, error) {
	path := strings.TrimSpace(value)
	if len(path) > 1 {
		path = strings.TrimRight(path, "/")
		if path == "" {
			path = "/"
		}
	}
	if !strings.HasPrefix(path, "/") || strings.ContainsFunc(path, isForbiddenPathRune) {
		return "", ErrInvalidPath
	}
	if len(path) > MaxPathLength {
		return "", ErrPathTooLong
	}
	if slices.Contains(reservedPaths, path) || path == reservedPrefix || strings.HasPrefix(path, reservedPrefix+"/") {
		return "", ErrReservedPath
	}
	return path, nil
}

// isForbiddenPathRune refuses what would end the rule early or turn the path
// into a pattern: whitespace and control characters end a robots.txt line's
// value, # starts a comment, * and $ are wildcards, and ? starts a query, which
// the storefront's variants already cover.
func isForbiddenPathRune(r rune) bool {
	return unicode.IsSpace(r) || unicode.IsControl(r) || strings.ContainsRune("*$?#", r)
}

// Querier reads the settings.
type Querier interface {
	GetTenantCrawlerSettings(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantCrawlerSetting, error)
}

// Writer writes the settings.
type Writer interface {
	UpsertTenantCrawlerSettings(ctx context.Context, arg dbmodels.UpsertTenantCrawlerSettingsParams) (dbmodels.TenantCrawlerSetting, error)
}

// Get reads the tenant's settings. A tenant that has saved nothing excludes
// nothing, and a stored token that Known no longer names is left out, so what
// Get answers is always something robots.txt may carry.
func Get(ctx context.Context, q Querier, tenantID uuid.UUID) (Settings, error) {
	row, err := q.GetTenantCrawlerSettings(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{UserAgents: []string{}, Paths: []string{}}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("read the crawler settings: %w", err)
	}
	return fromRow(row), nil
}

// Update stores settings, which Normalize has already answered, as the
// tenant's settings and answers what it stored.
func Update(ctx context.Context, q Writer, tenantID uuid.UUID, settings Settings) (Settings, error) {
	row, err := q.UpsertTenantCrawlerSettings(ctx, dbmodels.UpsertTenantCrawlerSettingsParams{
		TenantID:           tenantID,
		ExcludedUserAgents: nonNil(settings.UserAgents),
		ExcludedPaths:      nonNil(settings.Paths),
	})
	if err != nil {
		return Settings{}, fmt.Errorf("write the crawler settings: %w", err)
	}
	return fromRow(row), nil
}

func fromRow(row dbmodels.TenantCrawlerSetting) Settings {
	selected := make(map[string]struct{}, len(row.ExcludedUserAgents))
	for _, userAgent := range row.ExcludedUserAgents {
		selected[userAgent] = struct{}{}
	}
	return Settings{UserAgents: knownOrder(selected), Paths: nonNil(row.ExcludedPaths)}
}

// nonNil answers an empty, non-nil slice for nil: pq sends a nil slice as
// NULL, which the NOT NULL columns refuse.
func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
