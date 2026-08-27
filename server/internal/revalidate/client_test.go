package revalidate

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestNewClientRequiresEveryWebAppURL(t *testing.T) {
	setInternalURLs(t, "http://web-host:3000", "", "http://web-platform:4100")

	client, err := NewClient("token", nil)
	if client != nil {
		t.Fatal("NewClient() = non-nil, want nil")
	}
	if err == nil || !strings.Contains(err.Error(), webAdminInternalURLEnv) {
		t.Fatalf("NewClient() error = %v, want missing %s", err, webAdminInternalURLEnv)
	}
}

func TestBuildEndpointUsesInternalRevalidatePath(t *testing.T) {
	endpoint, err := buildEndpoint("http://web-host:3000/internal")
	if err != nil {
		t.Fatalf("buildEndpoint() error = %v", err)
	}
	if endpoint != "http://web-host:3000/internal/api/revalidate" {
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
			if r.URL.Path != "/api/revalidate" {
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
