package testutil

import (
	"context"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
)

// SavePlatformPolicy stores policy as the platform's saved policy, as if an
// operator had saved it from the console. It must run before the server under
// test first resolves the policy, which it caches.
func (e *PostgresEnv) SavePlatformPolicy(t *testing.T, policy platformpolicy.Policy) {
	t.Helper()
	if e.DB == nil {
		t.Fatal("postgres env db is nil; call Reset first if needed")
	}
	if err := policy.Validate(); err != nil {
		t.Fatalf("invalid platform policy: %v", err)
	}
	if _, err := dbmodels.New(e.DB).InsertPlatformPolicyConfig(context.Background(), dbmodels.InsertPlatformPolicyConfigParams(policy.ConfigParams())); err != nil {
		t.Fatalf("save platform policy: %v", err)
	}
}
