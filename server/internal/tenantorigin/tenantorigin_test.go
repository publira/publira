package tenantorigin

import (
	"database/sql"
	"errors"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestSite(t *testing.T) {
	tests := []struct {
		name   string
		scheme string
		port   string
		domain string
		want   string
	}{
		{name: "defaults to https with no port", domain: "store.example", want: "https://store.example"},
		{name: "drops a saved scheme and trailing slash", domain: " https://store.example/ ", want: "https://store.example"},
		{name: "takes the scheme and port from the environment", scheme: "http", port: "3180", domain: "comics.localhost", want: "http://comics.localhost:3180"},
		{name: "reads the scheme case-insensitively", scheme: "HTTP", domain: "comics.localhost", want: "http://comics.localhost"},
		{name: "keeps a port on https", port: "8443", domain: "store.example", want: "https://store.example:8443"},
		{name: "omits the https default port", scheme: "https", port: "443", domain: "store.example", want: "https://store.example"},
		{name: "omits the http default port", scheme: "http", port: "80", domain: "store.example", want: "http://store.example"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(SchemeEnv, tt.scheme)
			t.Setenv(PortEnv, tt.port)
			got, err := Site(dbmodels.Tenant{Domain: tt.domain})
			if err != nil {
				t.Fatalf("Site: %v", err)
			}
			if got.String() != tt.want {
				t.Fatalf("Site = %q, want %q", got.String(), tt.want)
			}
		})
	}
}

func TestSiteRequiresADomain(t *testing.T) {
	t.Setenv(SchemeEnv, "")
	t.Setenv(PortEnv, "")
	if _, err := Site(dbmodels.Tenant{Domain: " / "}); !errors.Is(err, ErrDomainNotConfigured) {
		t.Fatalf("Site error = %v, want %v", err, ErrDomainNotConfigured)
	}
}

func TestAdminConsole(t *testing.T) {
	tests := []struct {
		name        string
		scheme      string
		port        string
		domain      string
		adminDomain sql.NullString
		want        string
	}{
		{name: "prefers the saved admin domain", domain: "store.example", adminDomain: sql.NullString{String: "console.example", Valid: true}, want: "https://console.example"},
		{name: "derives the admin host from the storefront domain", domain: "store.example", want: "https://admin.store.example"},
		{name: "derives the admin host when the saved one is blank", domain: "https://store.example/", adminDomain: sql.NullString{String: " ", Valid: true}, want: "https://admin.store.example"},
		{name: "takes the scheme and port from the environment", scheme: "http", port: "3180", domain: "comics.localhost", want: "http://admin.comics.localhost:3180"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(SchemeEnv, tt.scheme)
			t.Setenv(PortEnv, tt.port)
			got, err := AdminConsole(dbmodels.Tenant{Domain: tt.domain, AdminDomain: tt.adminDomain})
			if err != nil {
				t.Fatalf("AdminConsole: %v", err)
			}
			if got.String() != tt.want {
				t.Fatalf("AdminConsole = %q, want %q", got.String(), tt.want)
			}
		})
	}
}

func TestAdminConsoleRequiresADomain(t *testing.T) {
	t.Setenv(SchemeEnv, "")
	t.Setenv(PortEnv, "")
	if _, err := AdminConsole(dbmodels.Tenant{}); !errors.Is(err, ErrAdminDomainNotConfigured) {
		t.Fatalf("AdminConsole error = %v, want %v", err, ErrAdminDomainNotConfigured)
	}
}

func TestOriginRejectsAnInvalidEnvironment(t *testing.T) {
	tests := []struct {
		name   string
		scheme string
		port   string
	}{
		{name: "a scheme other than http or https", scheme: "ftp"},
		{name: "a port that is not a number", port: "web"},
		{name: "a port out of range", port: "65536"},
		{name: "a zero port", port: "0"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(SchemeEnv, tt.scheme)
			t.Setenv(PortEnv, tt.port)
			if _, err := Site(dbmodels.Tenant{Domain: "store.example"}); err == nil {
				t.Fatal("Site error = nil")
			}
			if err := CheckEnv(); err == nil {
				t.Fatal("CheckEnv error = nil")
			}
		})
	}
}

func TestCheckEnvAcceptsTheDefaultsAndAnOverride(t *testing.T) {
	for _, env := range [][2]string{{"", ""}, {"http", "3180"}} {
		t.Setenv(SchemeEnv, env[0])
		t.Setenv(PortEnv, env[1])
		if err := CheckEnv(); err != nil {
			t.Fatalf("CheckEnv(%q, %q) = %v", env[0], env[1], err)
		}
	}
}
