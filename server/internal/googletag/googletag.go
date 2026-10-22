// Package googletag validates and reads the Google tag a tenant's storefront
// loads (tenant_analytics_settings): a Google Analytics 4 measurement ID, a
// Google Tag Manager container ID, and where the tag is served from.
//
// A tenant that names neither ID loads no tag, whatever its serving mode
// holds, so clearing both IDs is how measurement is switched off. Every value
// here appears in the HTML of every storefront page, so none of it is secret.
package googletag

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base32"
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/net/idna"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// The stored serving modes, matching the CHECK constraint on
// tenant_analytics_settings.serving_mode.
const (
	// ServingModeGoogle loads the tag from Google. It is what a tenant that has
	// never chosen gets.
	ServingModeGoogle = "google"
	// ServingModeServerContainer loads the tag from, and sends its hits to, the
	// tenant's server-side Tag Manager container.
	ServingModeServerContainer = "server_container"
	// ServingModeGateway serves the tag on a path of the storefront's own
	// origin, which Publira proxies to Google or to the server container.
	ServingModeGateway = "gateway"
)

const (
	// ActionSettingsUpdated is the audit action of a change to the settings.
	ActionSettingsUpdated = "tenant_analytics_settings_updated"
	// AuditTargetType is the audit target of a change to the settings.
	AuditTargetType = "tenant_analytics_settings"

	// maxServerContainerURLLength bounds a stored origin: the longest host DNS
	// carries, a port, and the scheme.
	maxServerContainerURLLength = len("https://") + 253 + len(":65535")
	// gatewayPathRandomBytes is the entropy behind a gateway path: 80 bits,
	// which base32 spells in exactly 16 characters.
	gatewayPathRandomBytes = 10
)

// SupportedServingModes lists every serving mode this build can act on.
var SupportedServingModes = []string{ServingModeGoogle, ServingModeServerContainer, ServingModeGateway}

var (
	// ErrInvalidMeasurementID refuses a value that is not a GA4 measurement ID.
	ErrInvalidMeasurementID = errors.New("measurement ID must be G- followed by letters and digits")
	// ErrUniversalAnalyticsID refuses a Universal Analytics property ID, which
	// Google no longer collects for.
	ErrUniversalAnalyticsID = errors.New("a Universal Analytics ID (UA-) is no longer collected for; use a Google Analytics 4 measurement ID (G-)")
	// ErrInvalidContainerID refuses a value that is not a Tag Manager container
	// ID.
	ErrInvalidContainerID = errors.New("container ID must be GTM- followed by letters and digits")
	// ErrInvalidServerContainerURL refuses a server container URL that is not
	// an https origin on a domain name.
	ErrInvalidServerContainerURL = errors.New("server container URL must be an https origin on a domain name, such as https://sgtm.example.com, with no path, query, or fragment")
	// ErrServerContainerURLRequired refuses ServingModeServerContainer without
	// a server container URL to serve from.
	ErrServerContainerURLRequired = errors.New("server container URL is required to serve the tag from a server container")
	// ErrUnresolvedServingMode is a stored serving mode this build does not
	// know. There is no stand-in: loading the tag from Google for a tenant that
	// chose its own container would send its readers' hits somewhere it did not
	// choose.
	ErrUnresolvedServingMode = errors.New("stored serving_mode names no supported mode")
)

var (
	// The measurement and container ID patterns bound the length to what the
	// CHECK constraints accept; Google's own IDs are far shorter.
	measurementIDPattern = regexp.MustCompile(`^G-[A-Z0-9]{1,30}$`)
	containerIDPattern   = regexp.MustCompile(`^GTM-[A-Z0-9]{1,28}$`)
	// hostnamePattern is an A-label host of two labels or more, as
	// idna.Lookup answers it.
	hostnamePattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)
	// gatewayPathEncoding spells a gateway path in lowercase letters and the
	// digits 2 to 7.
	gatewayPathEncoding = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)
)

// Settings is the Google tag a tenant's storefront loads. An empty string is
// a value the tenant has not set.
type Settings struct {
	GA4MeasurementID   string
	GTMContainerID     string
	ServingMode        string
	ServerContainerURL string
	GatewayPath        string
}

// Default is what a tenant that has saved nothing reads as: no tag, loaded
// from Google once one is named.
func Default() Settings {
	return Settings{ServingMode: ServingModeGoogle}
}

// Measures reports whether the settings load a tag at all.
func (s Settings) Measures() bool {
	return s.GA4MeasurementID != "" || s.GTMContainerID != ""
}

// Querier reads the settings.
type Querier interface {
	GetTenantAnalyticsSettings(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantAnalyticsSetting, error)
}

// Get reads the tenant's settings, and Default for a tenant that has saved
// nothing. A stored serving mode this build does not know is
// ErrUnresolvedServingMode.
func Get(ctx context.Context, q Querier, tenantID uuid.UUID) (Settings, error) {
	row, err := q.GetTenantAnalyticsSettings(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return Default(), nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("read the analytics settings: %w", err)
	}
	return FromRow(row)
}

// FromRow answers a stored row as Settings.
func FromRow(row dbmodels.TenantAnalyticsSetting) (Settings, error) {
	if !slices.Contains(SupportedServingModes, row.ServingMode) {
		return Settings{}, fmt.Errorf("%w: %q", ErrUnresolvedServingMode, row.ServingMode)
	}
	return Settings{
		GA4MeasurementID:   row.Ga4MeasurementID.String,
		GTMContainerID:     row.GtmContainerID.String,
		ServingMode:        row.ServingMode,
		ServerContainerURL: row.ServerContainerUrl.String,
		GatewayPath:        row.GatewayPath.String,
	}, nil
}

// NormalizeMeasurementID trims and capitalizes a GA4 measurement ID, and
// answers "" for a blank one.
func NormalizeMeasurementID(raw string) (string, error) {
	id := strings.ToUpper(strings.TrimSpace(raw))
	switch {
	case id == "":
		return "", nil
	case strings.HasPrefix(id, "UA-"):
		return "", ErrUniversalAnalyticsID
	case !measurementIDPattern.MatchString(id):
		return "", ErrInvalidMeasurementID
	}
	return id, nil
}

// NormalizeContainerID trims and capitalizes a Tag Manager container ID, and
// answers "" for a blank one.
func NormalizeContainerID(raw string) (string, error) {
	id := strings.ToUpper(strings.TrimSpace(raw))
	if id == "" {
		return "", nil
	}
	if !containerIDPattern.MatchString(id) {
		return "", ErrInvalidContainerID
	}
	return id, nil
}

// NormalizeServerContainerURL answers a server container URL as the origin it
// names (https://sgtm.example.com), with the host in lowercase A-labels and
// the default port left out, and "" for a blank one.
//
// The host has to be a domain name. The gateway forwards readers' requests to
// this origin from Publira's own network, so an IP address — and with it a
// private or loopback one — is refused rather than reached.
func NormalizeServerContainerURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	// url.Parse drops an empty query or fragment, so their markers are
	// refused before it can.
	if len(trimmed) > maxServerContainerURLLength || strings.ContainsAny(trimmed, "?# \t") {
		return "", ErrInvalidServerContainerURL
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Opaque != "" || parsed.User != nil ||
		(parsed.Path != "" && parsed.Path != "/") || strings.HasSuffix(parsed.Host, ":") {
		return "", ErrInvalidServerContainerURL
	}
	hostname := parsed.Hostname()
	if hostname == "" || net.ParseIP(hostname) != nil {
		return "", ErrInvalidServerContainerURL
	}
	host, err := idna.Lookup.ToASCII(hostname)
	if err != nil || !hostnamePattern.MatchString(host) {
		return "", ErrInvalidServerContainerURL
	}
	// A dotted host whose last label is a number is an IPv4 address spelled
	// in a form net.ParseIP does not read, such as 127.1.
	labels := strings.Split(host, ".")
	if _, err := strconv.Atoi(labels[len(labels)-1]); err == nil {
		return "", ErrInvalidServerContainerURL
	}
	if port := parsed.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return "", ErrInvalidServerContainerURL
		}
		if number != 443 {
			host += ":" + strconv.Itoa(number)
		}
	}
	return "https://" + host, nil
}

// NewGatewayPath generates a gateway path: an underscore and 16 random
// letters and digits.
//
// The underscore is what keeps it off every page: a page slug is lowercase
// letters, digits, and hyphens, and no screen of the storefront has one in
// its path either. The rest is random per tenant, so no fixed path shared by
// every Publira storefront is there for a block list to pick up.
func NewGatewayPath() (string, error) {
	random := make([]byte, gatewayPathRandomBytes)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("generate a gateway path: %w", err)
	}
	return "_" + gatewayPathEncoding.EncodeToString(random), nil
}
