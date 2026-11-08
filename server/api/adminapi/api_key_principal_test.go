package adminapi

import (
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/tenantapikeys"
)

// A read scope admits reads and catalog:write admits writes. A procedure is a
// read here by its name, List or Get, and by its level: the catalog's reads are
// tenant_auditor reads, and only purchases:read reaches a tenant_admin one, the
// purchases, which a key exists to read. The writes are AdminSeriesService's
// tenant_editor writes, so a key never reaches what a Tenant admin alone may
// change.
func TestAPIKeyProceduresKeepToTheirScopes(t *testing.T) {
	levels := adminRPCLevels(t)
	for procedure, scope := range apiKeyProcedures {
		method := procedure[strings.LastIndex(procedure, "/")+1:]
		read := strings.HasPrefix(method, "List") || strings.HasPrefix(method, "Get")
		if !tenantapikeys.ValidScope(scope) {
			t.Errorf("%s is admitted by %q, which is no scope", procedure, scope)
		}
		if scope == tenantapikeys.ScopeCatalogWrite && read {
			t.Errorf("%s is a read admitted by catalog:write, which admits writes alone", procedure)
		}
		if scope != tenantapikeys.ScopeCatalogWrite && !read {
			t.Errorf("%s is open to API keys through %q and is not named as a read", procedure, scope)
		}
		level, ok := levels[procedure]
		switch {
		case !ok:
			t.Errorf("%s is open to API keys and is no admin RPC", procedure)
		case scope == tenantapikeys.ScopeCatalogRead && level != auth.RoleTenantAuditor:
			t.Errorf("%s is a catalog read at level %q; only tenant_auditor reads may be", procedure, level)
		case scope == tenantapikeys.ScopeCatalogWrite && (level != auth.RoleTenantEditor || !strings.HasPrefix(procedure, "/publira.admin.v1.AdminSeriesService/")):
			t.Errorf("%s is admitted by catalog:write at level %q; only AdminSeriesService's tenant_editor writes may be", procedure, level)
		case scope == tenantapikeys.ScopePurchasesRead && !strings.HasPrefix(procedure, "/publira.admin.v1.AdminPurchaseService/"):
			t.Errorf("%s is admitted by purchases:read and is not a purchase read", procedure)
		}
	}
}
