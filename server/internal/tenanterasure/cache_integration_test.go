package tenanterasure_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenanterasure"
	"github.com/publira/publira/server/internal/testutil"
)

// The erasure deletes what the image routes and the rate limits keep for the
// tenant in the shared Redis, found by the tenant's IDs, and nothing they keep
// for another tenant or for a client.
func TestRedisCacheErasesOnlyTheTenantsEntries(t *testing.T) {
	url := testutil.StartValkey(t)
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	cache, err := tenanterasure.NewRedisCache(url)
	if err != nil {
		t.Fatalf("NewRedisCache: %v", err)
	}
	t.Cleanup(func() { _ = cache.Close() })

	// Public IDs and tenant IDs of the test's own, so the keyspace it shares
	// with other tests holds nothing else they match.
	deleted := dbmodels.Tenant{ID: uuid.Must(uuid.NewV7()), PublicID: "ErasTNNT" + uuid.NewString()[:4]}
	kept := dbmodels.Tenant{ID: uuid.Must(uuid.NewV7()), PublicID: "KeptTNNT" + uuid.NewString()[:4]}
	keys := func(tenant dbmodels.Tenant) []string {
		return []string{
			"publira:img:" + tenant.PublicID + ":0123abcd",
			"publira:rl:comment.post:" + tenant.ID.String() + ":" + uuid.NewString() + "|60000000000|1",
			"publira:rl:mail.address:" + tenant.ID.String() + ":digest|3600000000000|7",
			"publira:rl:api_key.request:" + tenant.ID.String() + ":" + uuid.NewString() + "|60000000000|2",
		}
	}
	deletedKeys := keys(deleted)
	client := "publira:rl:contact.message:client:203.0.113.7-" + uuid.NewString() + "|3600000000000|1"
	all := append(append(slices.Clone(deletedKeys), keys(kept)...), client)
	for _, key := range all {
		if err := cache.Client.Set(ctx, key, "1", time.Minute).Err(); err != nil {
			t.Fatalf("set %s: %v", key, err)
		}
	}

	erased, err := cache.EraseTenant(ctx, deleted)
	if err != nil {
		t.Fatalf("EraseTenant: %v", err)
	}
	if erased != len(deletedKeys) {
		t.Errorf("erased %d entries, want %d", erased, len(deletedKeys))
	}
	for _, key := range all {
		n, err := cache.Client.Exists(ctx, key).Result()
		if err != nil {
			t.Fatalf("exists %s: %v", key, err)
		}
		if want := !slices.Contains(deletedKeys, key); (n == 1) != want {
			t.Errorf("%s present = %v, want %v", key, n == 1, want)
		}
	}
}
