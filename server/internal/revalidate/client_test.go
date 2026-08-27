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
