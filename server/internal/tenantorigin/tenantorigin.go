// Package tenantorigin turns a tenant's configured host into the origin a link
// to it is built on. The scheme and the port are properties of the deployment
// rather than of the tenant, so they come from the environment of the process
// building the link: `https` and no port unless an operator sets them.
package tenantorigin

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

const (
	// SchemeEnv names the scheme every tenant host is served on: `https` or
	// `http`.
	SchemeEnv = "PUBLIRA_TENANT_URL_SCHEME"
	// PortEnv names the port every tenant host is served on, when it is not
	// the scheme's own.
	PortEnv = "PUBLIRA_TENANT_URL_PORT"
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

// CheckEnv reports a scheme or port the environment names that no origin can
// be built on, for a caller that must refuse before it writes anything.
func CheckEnv() error {
	_, _, err := deployment()
	return err
}

func origin(host string) (*url.URL, error) {
	scheme, port, err := deployment()
	if err != nil {
		return nil, err
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	}
	return &url.URL{Scheme: scheme, Host: host}, nil
}

// deployment reads the scheme and the port, leaving the port empty when it is
// the scheme's own.
func deployment() (scheme, port string, err error) {
	scheme = strings.ToLower(strings.TrimSpace(os.Getenv(SchemeEnv)))
	switch scheme {
	case "":
		scheme = "https"
	case "http", "https":
	default:
		return "", "", fmt.Errorf("%s must be http or https, not %q", SchemeEnv, scheme)
	}
	port = strings.TrimSpace(os.Getenv(PortEnv))
	if port == "" {
		return scheme, "", nil
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return "", "", fmt.Errorf("%s must be a port number, not %q", PortEnv, port)
	}
	if (scheme == "https" && number == 443) || (scheme == "http" && number == 80) {
		return scheme, "", nil
	}
	return scheme, strconv.Itoa(number), nil
}
