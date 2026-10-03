package dbtest

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/recommendfeatures"
	"github.com/publira/publira/server/internal/tenantday"
	"github.com/publira/publira/server/internal/testutil"
)

// db/seeds/dev/090_reading_signals.sql writes the development member's
// recommendation features itself, next to the events they summarise, because
// the worker builds features only once the rankings have moved past them. The
// row is a copy of the batch's output, so it is checked against the batch:
// rebuilding the seed tenant's window from the seeded events has to write the
// same features under the same version, or a change to the batch has left the
// seed describing a shape no build writes any more.
func TestDevSeedRecommendFeaturesMatchTheBatch(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	devSeed := filepath.Join("..", "..", "..", "db", "seeds", "dev.sql")
	if _, err := pg.DB.ExecContext(ctx, readSeedSQL(t, devSeed, map[string]string{"tenant_port": "3080"})); err != nil {
		t.Fatalf("apply %s: %v", devSeed, err)
	}

	const memberFeatures = `
		SELECT urf.features::text, urf.feature_version
		FROM user_recommend_features urf
		JOIN tenants t ON t.id = urf.tenant_id
		JOIN users u ON u.id = urf.user_id
		WHERE t.public_id = 'SeedTNNTAAA1'
			AND u.email = 'member@example.com'`

	var seeded string
	var seededVersion int
	if err := pg.DB.QueryRowContext(ctx, memberFeatures).Scan(&seeded, &seededVersion); err != nil {
		t.Fatalf("read the seeded features of the member: %v", err)
	}
	if seededVersion != recommendfeatures.FeatureVersion {
		t.Fatalf("the seed stamps feature_version %d, the batch writes %d", seededVersion, recommendfeatures.FeatureVersion)
	}

	var tenant tenantday.Tenant
	if err := pg.DB.QueryRowContext(ctx,
		`SELECT id, timezone FROM tenants WHERE public_id = 'SeedTNNTAAA1'`,
	).Scan(&tenant.ID, &tenant.TimeZone); err != nil {
		t.Fatalf("read the seed tenant: %v", err)
	}
	yesterday, err := tenant.Date(time.Time{}, time.Now())
	if err != nil {
		t.Fatalf("resolve the seed tenant's yesterday: %v", err)
	}
	users, _, err := recommendfeatures.New(pg.DB).RunTenant(ctx, tenant, yesterday, 0)
	if err != nil {
		t.Fatalf("build the seed tenant's features: %v", err)
	}
	if users != 1 {
		t.Fatalf("the batch built features for %d readers of the seed tenant, want the member alone", users)
	}

	var same bool
	if err := pg.DB.QueryRowContext(ctx,
		`SELECT features::jsonb = $1::jsonb FROM (`+memberFeatures+`) built(features, feature_version)`,
		seeded,
	).Scan(&same); err != nil {
		t.Fatalf("compare the member's features: %v", err)
	}
	if !same {
		var built string
		if err := pg.DB.QueryRowContext(ctx, memberFeatures).Scan(&built, new(int)); err != nil {
			t.Fatalf("read the built features of the member: %v", err)
		}
		t.Fatalf("the seed's features differ from the batch's\nseeded: %s\nbuilt:  %s", seeded, built)
	}
}
