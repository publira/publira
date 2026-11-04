package adminapi

import (
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/tenantapikeys"
)

// An API key reads and never writes. A procedure is a read here by its name,
// List or Get, and by its level: the catalog's reads are tenant_auditor reads,
// and only purchases:read reaches a tenant_admin one, the purchases, which a
// key exists to read.
func TestAPIKeyProceduresAreReads(t *testing.T) {
	levels := adminRPCLevels(t)
	for procedure, scope := range apiKeyProcedures {
		method := procedure[strings.LastIndex(procedure, "/")+1:]
		if !strings.HasPrefix(method, "List") && !strings.HasPrefix(method, "Get") {
			t.Errorf("%s is open to API keys and is not named as a read", procedure)
		}
		if !tenantapikeys.ValidScope(scope) {
			t.Errorf("%s is admitted by %q, which is no scope", procedure, scope)
		}
		level, ok := levels[procedure]
		switch {
		case !ok:
			t.Errorf("%s is open to API keys and is no admin RPC", procedure)
		case scope == tenantapikeys.ScopeCatalogRead && level != auth.RoleTenantAuditor:
			t.Errorf("%s is a catalog read at level %q; only tenant_auditor reads may be", procedure, level)
		case scope == tenantapikeys.ScopePurchasesRead && !strings.HasPrefix(procedure, "/publira.admin.v1.AdminPurchaseService/"):
			t.Errorf("%s is admitted by purchases:read and is not a purchase read", procedure)
		}
	}
}
