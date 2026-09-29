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
		domain string
		want   string
	}{
		{name: "defaults to https with no port", domain: "store.example", want: "https://store.example"},
		{name: "drops a saved scheme and trailing slash", domain: " https://store.example/ ", want: "https://store.example"},
		{name: "takes the scheme from the environment", scheme: "http", domain: "comics.localhost", want: "http://comics.localhost"},
		{name: "reads the scheme case-insensitively", scheme: "HTTP", domain: "comics.localhost", want: "http://comics.localhost"},
		{name: "keeps a port saved on the domain", scheme: "http", domain: "comics.localhost:3180", want: "http://comics.localhost:3180"},
		{name: "keeps a saved https port under an http scheme", scheme: "http", domain: "store.example:443", want: "http://store.example:443"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(SchemeEnv, tt.scheme)
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
	if _, err := Site(dbmodels.Tenant{Domain: " / "}); !errors.Is(err, ErrDomainNotConfigured) {
		t.Fatalf("Site error = %v, want %v", err, ErrDomainNotConfigured)
	}
}

func TestAdminConsole(t *testing.T) {
	tests := []struct {
		name        string
		scheme      string
		domain      string
		adminDomain sql.NullString
		want        string
	}{
		{name: "prefers the saved admin domain", domain: "store.example", adminDomain: sql.NullString{String: "console.example", Valid: true}, want: "https://console.example"},
		{name: "derives the admin host from the storefront domain", domain: "store.example", want: "https://admin.store.example"},
		{name: "derives the admin host when the saved one is blank", domain: "https://store.example/", adminDomain: sql.NullString{String: " ", Valid: true}, want: "https://admin.store.example"},
		{name: "keeps a port saved on the admin domain", scheme: "http", domain: "comics.localhost", adminDomain: sql.NullString{String: "console.example:9443", Valid: true}, want: "http://console.example:9443"},
		{name: "keeps a port saved on the storefront domain when deriving the console host", scheme: "http", domain: "comics.localhost:3180", want: "http://admin.comics.localhost:3180"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(SchemeEnv, tt.scheme)
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
	if _, err := AdminConsole(dbmodels.Tenant{}); !errors.Is(err, ErrAdminDomainNotConfigured) {
		t.Fatalf("AdminConsole error = %v, want %v", err, ErrAdminDomainNotConfigured)
	}
}

func TestOriginRejectsAnInvalidScheme(t *testing.T) {
	t.Setenv(SchemeEnv, "ftp")
	if _, err := Site(dbmodels.Tenant{Domain: "store.example"}); err == nil {
		t.Fatal("Site error = nil")
	}
	if err := CheckEnv(); err == nil {
		t.Fatal("CheckEnv error = nil")
	}
}

func TestCheckEnvAcceptsTheDefaultAndAnOverride(t *testing.T) {
	for _, scheme := range []string{"", "http"} {
		t.Setenv(SchemeEnv, scheme)
		if err := CheckEnv(); err != nil {
			t.Fatalf("CheckEnv(%q) = %v", scheme, err)
		}
	}
}
