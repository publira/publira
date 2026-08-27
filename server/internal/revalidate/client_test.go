package revalidate

import "testing"

func TestInternalRevalidateEndpointUsesTraefikWebEntrypoint(t *testing.T) {
	endpoint, err := buildEndpoint(internalRevalidateBaseURL, revalidatePath)
	if err != nil {
		t.Fatalf("buildEndpoint() error = %v", err)
	}
	if endpoint != "http://traefik:3080/api/revalidate" {
		t.Fatalf("endpoint = %q, want http://traefik:3080/api/revalidate", endpoint)
	}
}

func TestRevalidateBaseURLUsesConfiguredProfileWebHost(t *testing.T) {
	t.Setenv("PUBLIRA_REVALIDATE_BASE_URL", "http://127.0.0.1:13100")

	endpoint, err := buildEndpoint(revalidateBaseURL(), revalidatePath)
	if err != nil {
		t.Fatalf("buildEndpoint() error = %v", err)
	}
	if endpoint != "http://127.0.0.1:13100/api/revalidate" {
		t.Fatalf("endpoint = %q, want profile web-host endpoint", endpoint)
	}
}
