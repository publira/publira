package main

import (
	"context"
	"log/slog"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/testutil"
)

// A process that serves the tenant console alone charges its images to the
// limit saved as the platform's policy, the one every instance reads, rather
// than to the built-in one a server handed no guard falls back to.
func TestAConsoleOnlyServerChargesItsImagesToTheSavedLimit(t *testing.T) {
	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	policy := platformpolicy.Defaults()
	policy.AnonymousReads.Images = platformpolicy.EdgeReadLimits().Images
	if _, err := platformpolicy.Save(context.Background(), pg.DB, slog.Default(), auditlog.SystemPlatformActor, platformpolicy.SaveParams{Policy: policy}, revalidate.RecordCatalogDrop); err != nil {
		t.Fatalf("save the platform policy: %v", err)
	}
	if policy.AnonymousReads.Images >= platformpolicy.Defaults().AnonymousReads.Images {
		t.Fatalf("the saved images limit %d is not below the built-in one, so the test could not tell them apart", policy.AnonymousReads.Images)
	}

	base := serveOnPools(t, serverPools{admin: pg.OpenAdminDB(t)})
	fetch := func() int {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, base+"/images/creators/"+uuid.NewString(), nil)
		if err != nil {
			t.Fatalf("build the request: %v", err)
		}
		req.Host = "admin-" + tenant.Domain
		req.Header.Set("Forwarded", "for=203.0.113.10")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("GET: %v", err)
		}
		_ = res.Body.Close()
		return res.StatusCode
	}

	for i := range policy.AnonymousReads.Images {
		if code := fetch(); code == http.StatusTooManyRequests {
			t.Fatalf("console image %d of the saved %d refused for its rate, want the whole allowance served", i+1, policy.AnonymousReads.Images)
		}
	}
	if code := fetch(); code != http.StatusTooManyRequests {
		t.Fatalf("console image past the saved %d: status = %d, want 429", policy.AnonymousReads.Images, code)
	}
}
