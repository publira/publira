package revalidate

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
)

func setInternalURLs(t *testing.T, hostURL, adminURL, platformURL string) {
	t.Helper()
	t.Setenv(webHostInternalURLEnv, hostURL)
	t.Setenv(webAdminInternalURLEnv, adminURL)
	t.Setenv(webPlatformInternalURLEnv, platformURL)
}

func TestNewClientIsDisabledWithoutToken(t *testing.T) {
	client, err := NewClient("  ", nil)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if client != nil {
		t.Fatal("NewClient() = non-nil, want nil")
	}
}

// A token with nowhere to send it can only be a mistake, so the error names
// every variable that could have been set.
func TestNewClientRequiresAtLeastOneWebAppURL(t *testing.T) {
	setInternalURLs(t, "", " ", "")

	client, err := NewClient("token", nil)
	if client != nil {
		t.Fatal("NewClient() = non-nil, want nil")
	}
	if err == nil {
		t.Fatal("NewClient() error = nil, want the missing URLs reported")
	}
	for _, env := range []string{webHostInternalURLEnv, webAdminInternalURLEnv, webPlatformInternalURLEnv} {
		if !strings.Contains(err.Error(), env) {
			t.Errorf("NewClient() error = %v, want it to name %s", err, env)
		}
	}
}

func TestNewClientRejectsAMalformedWebAppURL(t *testing.T) {
	setInternalURLs(t, "http://web-host:3000", "web-admin:4000", "")

	client, err := NewClient("token", nil)
	if client != nil {
		t.Fatal("NewClient() = non-nil, want nil")
	}
	if err == nil || !strings.Contains(err.Error(), webAdminInternalURLEnv) {
		t.Fatalf("NewClient() error = %v, want %s reported", err, webAdminInternalURLEnv)
	}
}

func TestNewClientSendsOnlyToTheWebAppsWithAURL(t *testing.T) {
	cases := []struct {
		name                           string
		hostURL, adminURL, platformURL string
		want                           []string
	}{
		{
			name:    "storefront only",
			hostURL: "http://web-host:3000",
			want:    []string{"web-host"},
		},
		{
			name:     "no platform console",
			hostURL:  "http://web-host:3000",
			adminURL: "http://web-admin:4000",
			want:     []string{"web-host", "web-admin"},
		},
		{
			name:        "every app",
			hostURL:     "http://web-host:3000",
			adminURL:    "http://web-admin:4000",
			platformURL: "http://web-platform:4100",
			want:        []string{"web-host", "web-admin", "web-platform"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setInternalURLs(t, tc.hostURL, tc.adminURL, tc.platformURL)

			client, err := NewClient("token", nil)
			if err != nil {
				t.Fatalf("NewClient() error = %v", err)
			}
			if got := client.Destinations(); !slices.Equal(got, tc.want) {
				t.Fatalf("Destinations() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestBuildEndpointUsesInternalRevalidatePath(t *testing.T) {
	endpoint, err := buildEndpoint("http://web-host:3000/internal")
	if err != nil {
		t.Fatalf("buildEndpoint() error = %v", err)
	}
	if endpoint != "http://web-host:3000/internal/api/v1/revalidate" {
		t.Fatalf("endpoint = %q, want direct revalidate endpoint", endpoint)
	}
}

func TestRevalidateTagsPostsToEveryWebAppWithoutTenantHeaders(t *testing.T) {
	var (
		mu       sync.Mutex
		requests []string
	)
	server := func(name string) *httptest.Server {
		t.Helper()
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				t.Errorf("%s method = %s, want POST", name, r.Method)
			}
			if r.URL.Path != "/api/v1/revalidate" {
				t.Errorf("%s path = %q, want direct revalidate endpoint", name, r.URL.Path)
			}
			if got := r.Header.Get("X-Forwarded-Host"); got != "" {
				t.Errorf("%s X-Forwarded-Host = %q, want empty", name, got)
			}
			if got := r.Header.Get("X-Revalidate-Token"); got != "token" {
				t.Errorf("%s X-Revalidate-Token = %q, want token", name, got)
			}
			var payload requestPayload
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("%s decode payload: %v", name, err)
			}
			if len(payload.Tags) != 2 || payload.Tags[0] != "tenant:tenant-a:site" || payload.Tags[1] != "tenant:tenant-b:site" {
				t.Errorf("%s payload = %#v", name, payload)
			}
			mu.Lock()
			requests = append(requests, name)
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		}))
	}
	webHost := server("web-host")
	defer webHost.Close()
	webAdmin := server("web-admin")
	defer webAdmin.Close()
	webPlatform := server("web-platform")
	defer webPlatform.Close()
	setInternalURLs(t, webHost.URL, webAdmin.URL, webPlatform.URL)

	client, err := NewClient("token", nil)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if err := client.RevalidateTags(context.Background(), []string{" tenant:tenant-a:site ", "tenant:tenant-b:site"}); err != nil {
		t.Fatalf("RevalidateTags() error = %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 3 {
		t.Fatalf("requests = %v, want all web apps", requests)
	}
}
