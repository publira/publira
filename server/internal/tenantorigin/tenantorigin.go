// Package tenantorigin turns a tenant's configured host into the origin a link
// to it is built on. The scheme comes from the environment, `https` when unset.
package tenantorigin

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

const (
	// SchemeEnv names the scheme every tenant host is served on: `https` or
	// `http`.
	SchemeEnv = "PUBLIRA_TENANT_URL_SCHEME"
)

var (
	// ErrDomainNotConfigured reports a tenant with no storefront domain.
	ErrDomainNotConfigured = errors.New("tenant domain is not configured")
	// ErrAdminDomainNotConfigured reports a tenant with neither an admin
	// domain nor a storefront domain to derive one from.
	ErrAdminDomainNotConfigured = errors.New("tenant admin domain is not configured")
)

// Site is the origin of the tenant's storefront.
func Site(tenant dbmodels.Tenant) (*url.URL, error) {
	host := normalizeHost(tenant.Domain)
	if host == "" {
		return nil, ErrDomainNotConfigured
	}
	return origin(host)
}

// AdminConsole is the origin of the tenant's admin console: its saved admin
// domain, or the `admin.` host under its storefront domain when none is saved.
func AdminConsole(tenant dbmodels.Tenant) (*url.URL, error) {
	host := ""
	if tenant.AdminDomain.Valid {
		host = normalizeHost(tenant.AdminDomain.String)
	}
	if host == "" {
		if site := normalizeHost(tenant.Domain); site != "" {
			host = "admin." + site
		}
	}
	if host == "" {
		return nil, ErrAdminDomainNotConfigured
	}
	return origin(host)
}

// normalizeHost drops a scheme or a trailing slash saved with a domain.
func normalizeHost(domain string) string {
	domain = strings.TrimSpace(domain)
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	return strings.TrimSuffix(domain, "/")
}

// CheckEnv reports a scheme no origin can be built on.
func CheckEnv() error {
	_, err := deploymentScheme()
	return err
}

func origin(host string) (*url.URL, error) {
	scheme, err := deploymentScheme()
	if err != nil {
		return nil, err
	}
	return &url.URL{Scheme: scheme, Host: host}, nil
}

func deploymentScheme() (string, error) {
	scheme := strings.ToLower(strings.TrimSpace(os.Getenv(SchemeEnv)))
	switch scheme {
	case "":
		return "https", nil
	case "http", "https":
		return scheme, nil
	default:
		return "", fmt.Errorf("%s must be http or https, not %q", SchemeEnv, scheme)
	}
}
