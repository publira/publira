package adminapi

import (
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/auth"
)

// callAdminProcedure posts a request naming nothing but the tenant to
// procedure as seat, and answers the Connect error code it got back, or "" for
// a success.
//
// Nothing else in the request is filled in, so an RPC its caller may use
// usually fails on a missing argument instead; what is asserted is only
// whether it got past its level.
func callAdminProcedure(t *testing.T, env *adminDBEnv, seat adminDBTenant, procedure string) string {
	t.Helper()

	body := `{"tenant":{"tenant_id":"` + seat.Tenant.ID.String() + `"}}`
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, env.Server.URL+procedure, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build the request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+seat.token())
	res, err := env.Server.Client().Do(req)
	if err != nil {
		t.Fatalf("call %s: %v", procedure, err)
	}
	defer res.Body.Close() //nolint:errcheck
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read the answer of %s: %v", procedure, err)
	}
	if res.StatusCode == http.StatusOK {
		return ""
	}
	var answer struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		t.Fatalf("decode the error of %s (%d): %v: %s", procedure, res.StatusCode, err, raw)
	}
	return answer.Code
}

// Every RPC with a level is called as each of the three roles: a role below
// the level is refused, and a role at or above it is not. This is what
// TestEveryAdminRPCRequiresItsLevel checks in the source, observed from the
// outside, so a helper that misreads the session fails here.
func TestDBEveryAdminRPCRefusesTheRolesBelowItsLevel(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	editor := admin.as(env.PG.SeedTenantUser(t, admin.Tenant.ID, "TAEDITOR01", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor))
	auditor := admin.as(env.PG.SeedTenantUser(t, admin.Tenant.ID, "TAAUDITOR01", "auditor@tenant-a.example.com", "Tenant A Auditor", auth.RoleTenantAuditor))

	levels := adminRPCLevels(t)
	procedures := make([]string, 0, len(levels))
	for procedure, level := range levels {
		if level != "" {
			procedures = append(procedures, procedure)
		}
	}
	slices.Sort(procedures)

	// The weaker seats go first, so nothing an admin's call writes is what a
	// later refusal is observed on.
	for _, seat := range []adminDBTenant{auditor, editor, admin} {
		for _, procedure := range procedures {
			level := levels[procedure]
			t.Run(seat.User.Role+procedure, func(t *testing.T) {
				code := callAdminProcedure(t, env, seat, procedure)
				if auth.TenantRoleAtLeast(seat.User.Role, level) {
					if code == "permission_denied" {
						t.Fatalf("%s refused %s, which its level %s admits", procedure, seat.User.Role, level)
					}
					return
				}
				if code != "permission_denied" {
					t.Fatalf("%s answered %s with %q, want permission_denied below its level %s", procedure, seat.User.Role, code, level)
				}
			})
		}
	}
}
