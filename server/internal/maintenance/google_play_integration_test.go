package maintenance

import (
	"bytes"
	"context"
	"database/sql"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

func newVoidedSyncEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{3}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

// seedPlayTenant stores a Google Play store for a tenant whose Android app is
// packageName, and one Play purchase of a paid episode bought with token.
func seedPlayTenant(t *testing.T, pg *testutil.PostgresEnv, encryptor *secretcrypto.Manager, publicID, packageName, token string, enabled bool) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	tenant := pg.SeedTenant(t, publicID, strings.ToLower(publicID)+".example.com", publicID)
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, android_application_id, android_sha256_cert_fingerprints)
		VALUES ($1, $2, ARRAY[$3])
	`, tenant.ID, packageName, strings.Repeat("AB:", 31)+"AB"); err != nil {
		t.Fatalf("set app identity: %v", err)
	}
	if _, err := paymentsettings.NewAppStores(dbmodels.New(pg.DB), encryptor).Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route: paymentsettings.RouteExternalCheckout,
		GooglePlay: paymentsettings.GooglePlayUpdate{
			Enabled:                     enabled,
			ServiceAccountKey:           testutil.ServiceAccountJSON(t, "reader-app", "publira@reader-app.iam.gserviceaccount.com"),
			ServiceAccountKeyUpdateMode: secretupdate.Replace,
		},
	}); err != nil {
		t.Fatalf("save google play settings: %v", err)
	}
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: publicID[:8] + "SER1"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: publicID[:8] + "EP01", Price: 300})
	reader := pg.SeedEndUser(t, tenant.ID, publicID[:8]+"USR1", "reader@"+strings.ToLower(publicID)+".example.com", "Reader")
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, store, store_transaction_id)
		VALUES ($1, $2, $3, $4, 300, 'google_play', $5)
	`, uuid.New(), tenant.ID, reader.ID, episode.ID, token); err != nil {
		t.Fatalf("insert play purchase: %v", err)
	}
	return tenant.ID
}

func refundedAt(t *testing.T, db *sql.DB, tenantID uuid.UUID, token string) sql.NullTime {
	t.Helper()
	var at sql.NullTime
	var amount sql.NullInt32
	if err := db.QueryRowContext(context.Background(),
		"SELECT refunded_at, refunded_amount FROM purchases WHERE tenant_id = $1 AND store = 'google_play' AND store_transaction_id = $2",
		tenantID, token,
	).Scan(&at, &amount); err != nil {
		t.Fatalf("read purchase: %v", err)
	}
	if at.Valid && amount.Int32 != 300 {
		t.Fatalf("refunded_amount = %v, want the whole price", amount)
	}
	return at
}

// A voided purchase is taken back on the tenant it belongs to, a voided token
// with no purchase yet is held for the confirmation that records it, and a
// second pass over the same window changes nothing.
func TestGooglePlayVoidedPurchaseSyncTakesBackRefundedPurchases(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newVoidedSyncEncryptor(t)
	now := time.Now()

	selling := seedPlayTenant(t, pg, encryptor, "PLAYSELLING1", "com.example.selling", "voided-token", true)
	kept := seedPlayTenant(t, pg, encryptor, "PLAYKEPTBUY1", "com.example.kept", "kept-token", true)
	off := seedPlayTenant(t, pg, encryptor, "PLAYOFFSTOR1", "com.example.off", "off-token", false)

	play := googleplaytest.NewServer(t)
	play.Void(t, "com.example.selling", "voided-token", now.Add(-2*time.Hour))
	play.Void(t, "com.example.selling", "unconfirmed-token", now.Add(-time.Hour))
	play.Void(t, "com.example.off", "off-token", now.Add(-time.Hour))

	deps := Deps{DB: pg.OpenContentStatsDB(t), Secrets: encryptor, GooglePlay: play.Client(), Logger: discardLogger()}
	for range 2 {
		if err := (GooglePlayVoidedPurchaseSync{}).run(context.Background(), deps, now); err != nil {
			t.Fatalf("run: %v", err)
		}
	}

	if !refundedAt(t, pg.DB, selling, "voided-token").Valid {
		t.Fatal("the voided purchase is not refunded")
	}
	if refundedAt(t, pg.DB, kept, "kept-token").Valid {
		t.Fatal("a purchase Google Play did not void is refunded")
	}
	// A tenant that switched Google Play off is not read.
	if refundedAt(t, pg.DB, off, "off-token").Valid {
		t.Fatal("a tenant with Google Play off had its purchase refunded")
	}
	var held int
	if err := pg.DB.QueryRowContext(context.Background(),
		"SELECT count(*) FROM unapplied_store_refunds WHERE tenant_id = $1 AND store = 'google_play' AND store_transaction_id = 'unconfirmed-token'", selling,
	).Scan(&held); err != nil {
		t.Fatalf("count held refunds: %v", err)
	}
	if held != 1 {
		t.Fatalf("held refunds = %d, want 1", held)
	}
	// Each pass reads the thirty days the API keeps, and no further.
	since := play.VoidedRequests[0].Get("startTime")
	if want := now.Add(-30*24*time.Hour + voidedPurchaseWindowMargin).UnixMilli(); since != strconv.FormatInt(want, 10) {
		t.Fatalf("startTime = %s, want %d", since, want)
	}
}
