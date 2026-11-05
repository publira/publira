package adminapi

import (
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/tenantapikeys"
)

// adminProcedurePath finds an admin procedure in a file, with or without the
// slash a Connect procedure starts with, since a path spells it `/rpc/publira…`
// and the routing check's list leaves `/rpc/` to the probe that sends it.
var adminProcedurePath = regexp.MustCompile(`publira\.admin\.v1\.\w+/\w+`)

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

// The edge forwards an API key's reads and answers the rest of the admin API
// itself, so a procedure added to apiKeyProcedures and to nothing else is one
// no system outside the install can call, and a path added to the edge alone
// is one more part of the admin API on the internet. Each file below states
// the list once and names no other procedure of the admin API.
func TestAPIKeyProceduresAreWhatTheEdgeForwards(t *testing.T) {
	const root = "../../../"
	files := []string{
		"infra/proxy/README.md",
		"infra/proxy/traefik/dynamic/routes.yaml",
		"infra/proxy/nginx/snippets/api-key-reads.conf",
		"infra/proxy/caddy/Caddyfile",
		"e2e/routing/scripts/lib.sh",
	}
	pages, err := filepath.Glob(root + "docs/*/2-deployments/4-edge/index.md")
	if err != nil {
		t.Fatalf("list the edge's documentation: %v", err)
	}
	if len(pages) == 0 {
		t.Fatal("found none of the edge's documentation")
	}
	for _, page := range pages {
		files = append(files, strings.TrimPrefix(page, root))
	}

	want := slices.Sorted(maps.Keys(apiKeyProcedures))
	for _, file := range files {
		content, err := os.ReadFile(root + file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		got := map[string]struct{}{}
		for _, procedure := range adminProcedurePath.FindAllString(string(content), -1) {
			got["/"+procedure] = struct{}{}
		}
		if listed := slices.Sorted(maps.Keys(got)); !slices.Equal(listed, want) {
			t.Errorf("%s names %v, apiKeyProcedures %v", file, listed, want)
		}
	}
}
