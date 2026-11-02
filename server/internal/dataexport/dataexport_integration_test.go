package dataexport_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/dataexport"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/storage/storagetest"
	"github.com/publira/publira/server/internal/testutil"
)

// exportFixture is a tenant with one reader who holds a record of every kind
// the archive is made of, and a second reader whose records must not appear.
type exportFixture struct {
	pg      *testutil.PostgresEnv
	tenant  testutil.Tenant
	reader  testutil.TenantUser
	other   testutil.TenantUser
	episode testutil.Episode
}

func newExportFixture(t *testing.T) *exportFixture {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "EXPORT000001", "export.example.com", "Export")
	reader := pg.SeedEndUser(t, tenant.ID, "EXPORTUSR001", "reader@export.example.com", "Reader")
	other := pg.SeedEndUser(t, tenant.ID, "EXPORTUSR002", "other@export.example.com", "Other")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "EXPORTSER001", Title: "The Lighthouse Keeper", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EXPORTEPI001", Title: "The First Night", OrderIndex: 1, Price: 500})
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "EXPORTCRE001", Name: "Aoi Tanaka"})
	plan := pg.SeedSubscriptionPlan(t, tenant.ID, testutil.SubscriptionPlanSeed{Name: "Monthly", StripePriceID: "price_export", PriceAmount: 980, Published: true})
	terms := pg.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "terms", Title: "Terms of service", ContentMarkdown: "Terms.", Published: true})

	f := &exportFixture{pg: pg, tenant: tenant, reader: reader, other: other, episode: episode}
	f.exec(t, `INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)`, tenant.ID, reader.ID, series.ID)
	f.exec(t, `INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)`, tenant.ID, reader.ID, episode.ID)
	f.exec(t, `INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)`, tenant.ID, reader.ID, creator.ID)
	f.exec(t, `INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)`, tenant.ID, other.ID, series.ID)
	f.exec(t, `INSERT INTO episode_reading_positions (tenant_id, user_id, episode_id, page_index, page_count) VALUES ($1, $2, $3, 3, 12)`, tenant.ID, reader.ID, episode.ID)
	f.exec(t, `INSERT INTO episode_reads (id, tenant_id, user_id, episode_id) VALUES ($1, $2, $3, $4)`, uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, episode.ID)
	f.exec(t, `INSERT INTO episode_ratings (tenant_id, user_id, episode_id, score) VALUES ($1, $2, $3, 4)`, tenant.ID, reader.ID, episode.ID)
	f.exec(t, `INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status) VALUES ($1, $2, 'EXPORTCOM001', $3, $4, 'What a night.', 'pending')`,
		uuid.Must(uuid.NewV7()), tenant.ID, episode.ID, reader.ID)
	othersComment := uuid.Must(uuid.NewV7())
	f.exec(t, `INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status) VALUES ($1, $2, 'EXPORTCOM002', $3, $4, 'Spoilers ahead.', 'pending')`,
		othersComment, tenant.ID, episode.ID, other.ID)
	f.exec(t, `INSERT INTO episode_comment_reports (id, tenant_id, comment_id, reporter_user_id, reason) VALUES ($1, $2, $3, $4, 'spoiler')`,
		uuid.Must(uuid.NewV7()), tenant.ID, othersComment, reader.ID)
	pg.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 500)
	pg.SeedSubscription(t, tenant.ID, reader.ID, plan.ID, testutil.SubscriptionSeed{StripeSubscriptionID: "sub_export", StripeCustomerID: "cus_export", Status: "active"})
	f.exec(t, `INSERT INTO user_notification_settings (tenant_id, user_id, comments_email_enabled) VALUES ($1, $2, false)`, tenant.ID, reader.ID)
	f.exec(t, `INSERT INTO user_viewer_preferences (tenant_id, user_id, wide_viewer_enabled) VALUES ($1, $2, true)`, tenant.ID, reader.ID)
	f.exec(t, `INSERT INTO user_page_consents (tenant_id, user_id, page_version_id) VALUES ($1, $2, $3)`, tenant.ID, reader.ID, terms.VersionID)
	f.exec(t, `INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, note) VALUES ($1, $2, 'EXPORTTIC001', $3, $4, 'Staff only')`,
		uuid.Must(uuid.NewV7()), tenant.ID, episode.ID, reader.ID)
	message := uuid.Must(uuid.NewV7())
	f.exec(t, `INSERT INTO contact_messages (id, tenant_id, public_id, user_id, reply_to_email, subject, body, staff_note) VALUES ($1, $2, 'EXPORTMSG001', $3, $4, 'Wrong date', 'My date of birth is wrong.', 'Staff only')`,
		message, tenant.ID, reader.ID, reader.Email)
	f.exec(t, `INSERT INTO contact_message_entries (id, tenant_id, contact_message_id, direction, body, from_email) VALUES ($1, $2, $3, 'reader', 'Any news?', $4)`,
		uuid.Must(uuid.NewV7()), tenant.ID, message, reader.Email)
	f.exec(t, `INSERT INTO user_identities (id, tenant_id, user_id, provider, subject, email_at_link) VALUES ($1, $2, $3, 'google', 'google-sub-export', $4)`,
		uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, reader.Email)
	f.exec(t, `INSERT INTO user_webauthn_credentials (id, public_id, tenant_id, user_id, rp_id, credential_id, public_key, aaguid, transports, backup_eligible, backed_up, name, relying_party)
		VALUES ($1, 'EXPORTPAS001', $2, $3, 'export.example.com', '\x01', '\x02', $4, '{internal}', false, false, 'This laptop', 'site')`,
		uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, uuid.Nil)
	return f
}

func (f *exportFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.pg.DB.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("seed %q: %v", strings.Fields(query)[2], err)
	}
}

// request records a request for reader, as RequestMyDataExport does.
func (f *exportFixture) request(t *testing.T, user testutil.TenantUser) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	f.exec(t, `INSERT INTO user_data_exports (id, tenant_id, user_id) VALUES ($1, $2, $3)`, id, f.tenant.ID, user.ID)
	return id
}

func (f *exportFixture) row(t *testing.T, id uuid.UUID) dbmodels.UserDataExport {
	t.Helper()
	var row dbmodels.UserDataExport
	if err := f.pg.DB.QueryRowContext(context.Background(), `
		SELECT id, tenant_id, user_id, requested_at, claimed_at, ready_at, failed_at, expires_at, object_key, size_bytes
		FROM user_data_exports WHERE id = $1
	`, id).Scan(&row.ID, &row.TenantID, &row.UserID, &row.RequestedAt, &row.ClaimedAt, &row.ReadyAt, &row.FailedAt, &row.ExpiresAt, &row.ObjectKey, &row.SizeBytes); err != nil {
		t.Fatalf("read data export %s: %v", id, err)
	}
	return row
}

func unzip(t *testing.T, archive []byte) map[string][]byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("open the archive: %v", err)
	}
	files := make(map[string][]byte, len(reader.File))
	for _, file := range reader.File {
		r, err := file.Open()
		if err != nil {
			t.Fatalf("open %s: %v", file.Name, err)
		}
		data, err := io.ReadAll(r)
		_ = r.Close()
		if err != nil {
			t.Fatalf("read %s: %v", file.Name, err)
		}
		files[file.Name] = data
	}
	return files
}

// The archive holds a record of every kind the install keeps about the
// reader, and nothing of another reader's, so a disclosure request is
// answered without an operator querying the database by hand.
func TestBuildHoldsEveryKindOfRecordOfTheReaderAlone(t *testing.T) {
	t.Parallel()
	f := newExportFixture(t)

	archive, err := dataexport.Build(context.Background(), dbmodels.New(f.pg.OpenContentStatsDB(t)), f.tenant.ID, f.reader.ID, "en")
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	files := unzip(t, archive)

	for _, name := range []string{
		dataexport.FileFollows, dataexport.FileReadingPositions, dataexport.FileReadingHistory,
		dataexport.FileRatings, dataexport.FileComments, dataexport.FileCommentReports,
		dataexport.FilePurchases, dataexport.FileSubscriptions, dataexport.FileLegalPageConsent,
		dataexport.FileAccessTickets, dataexport.FileContactMessages,
	} {
		var records []map[string]any
		if err := json.Unmarshal(files[name], &records); err != nil {
			t.Fatalf("%s is not a JSON list: %v\n%s", name, err, files[name])
		}
		if len(records) == 0 {
			t.Fatalf("%s holds no record, want the reader's", name)
		}
	}

	var follows []struct {
		Kind string `json:"kind"`
		Name string `json:"name"`
	}
	mustDecode(t, files[dataexport.FileFollows], &follows)
	if len(follows) != 3 {
		t.Fatalf("follows = %+v, want the reader's series, episode, and Author and none of the other reader's", follows)
	}

	var account struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	mustDecode(t, files[dataexport.FileAccount], &account)
	if account.ID != f.reader.PublicID || account.Email != f.reader.Email {
		t.Fatalf("account = %+v, want %s", account, f.reader.PublicID)
	}

	var methods struct {
		LinkedAccounts []map[string]any `json:"linked_accounts"`
		Passkeys       []map[string]any `json:"passkeys"`
	}
	mustDecode(t, files[dataexport.FileSignInMethods], &methods)
	if len(methods.LinkedAccounts) != 1 || len(methods.Passkeys) != 1 {
		t.Fatalf("sign-in methods = %s, want the linked Google account and the passkey", files[dataexport.FileSignInMethods])
	}

	var preferences struct {
		NotificationSettings *struct {
			Comments struct {
				Email bool `json:"email"`
			} `json:"comments"`
		} `json:"notification_settings"`
		ViewerPreferences *struct {
			WideViewer bool `json:"wide_viewer"`
		} `json:"viewer_preferences"`
	}
	mustDecode(t, files[dataexport.FilePreferences], &preferences)
	if preferences.NotificationSettings == nil || preferences.NotificationSettings.Comments.Email || preferences.ViewerPreferences == nil || !preferences.ViewerPreferences.WideViewer {
		t.Fatalf("preferences = %s, want the saved settings", files[dataexport.FilePreferences])
	}

	for name, data := range files {
		if strings.Contains(string(data), "Staff only") {
			t.Fatalf("%s carries a note staff keep for one another", name)
		}
		if strings.Contains(string(data), "Spoilers ahead.") {
			t.Fatalf("%s carries the body of another reader's comment", name)
		}
	}

	csv := string(files[dataexport.FilePurchasesCSV])
	if !strings.HasPrefix(csv, "\uFEFFpurchase_id,purchased_at,series_title,episode_number,episode_title,price,") {
		t.Fatalf("purchases.csv starts %q, want the purchase history CSV's header", csv[:min(len(csv), 120)])
	}
	if lines := strings.Split(strings.TrimSuffix(csv, "\r\n"), "\r\n"); len(lines) != 2 || !strings.Contains(lines[1], "The First Night") {
		t.Fatalf("purchases.csv = %q, want the header and the reader's one purchase", csv)
	}
}

func mustDecode(t *testing.T, data []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(data, v); err != nil {
		t.Fatalf("decode %s: %v", data, err)
	}
}

// One worker pass builds what was asked for, stores it, records it, and
// queues the notice that puts it in the reader's inbox and their mail.
func TestRunPendingBuildsStoresAndNotifiesInOnePass(t *testing.T) {
	t.Parallel()
	f := newExportFixture(t)
	id := f.request(t, f.reader)
	bucket := storagetest.NewMemory()
	now := time.Date(2026, 11, 2, 6, 0, 0, 0, time.UTC)

	summary, err := dataexport.RunPending(context.Background(), dataexport.Deps{
		DB:         f.pg.OpenContentStatsDB(t),
		Storage:    bucket,
		Reclaimers: bucket,
		Logger:     slog.New(slog.DiscardHandler),
		Now:        func() time.Time { return now },
	})
	if err != nil || summary != (dataexport.Summary{Built: 1}) {
		t.Fatalf("RunPending = %+v, %v, want one built", summary, err)
	}

	row := f.row(t, id)
	if !row.ReadyAt.Valid || !row.ExpiresAt.Time.Equal(now.Add(7*24*time.Hour)) {
		t.Fatalf("data export = %+v, want ready and kept for seven days", row)
	}
	if prefix := "tenants/" + f.tenant.PublicID + "/data-exports/" + id.String() + "/"; !strings.HasPrefix(row.ObjectKey.String, prefix) || !strings.HasSuffix(row.ObjectKey.String, ".zip") {
		t.Fatalf("object key = %q, want a ZIP under %q", row.ObjectKey.String, prefix)
	}
	stored, ok := bucket.Object(row.ObjectKey.String)
	if !ok || int64(len(stored)) != row.SizeBytes.Int64 {
		t.Fatalf("stored archive = %d bytes (%v), want the %d the row records", len(stored), ok, row.SizeBytes.Int64)
	}
	if files := unzip(t, stored); len(files) != 16 {
		t.Fatalf("archive holds %d files, want 16", len(files))
	}

	f.pg.ProcessPendingOutboxEvents(t, map[string]func(context.Context, dbmodels.OutboxEvent) error{
		outbox.EventTypeDataExportReadyNotification: outbox.NewDataExportReadyNotificationHandler(outbox.DataExportReadyNotificationHandlerConfig{DB: f.pg.OpenOutboxDB(t)}),
	})
	var category string
	var inInbox bool
	if err := f.pg.DB.QueryRowContext(context.Background(), `
		SELECT category, in_inbox FROM notifications
		WHERE tenant_id = $1 AND user_id = $2 AND notification_type = $3
	`, f.tenant.ID, f.reader.ID, outbox.NotificationTypeDataExportReady).Scan(&category, &inInbox); err != nil {
		t.Fatalf("read the reader's notification: %v", err)
	}
	if category != string(outbox.NotificationCategoryAccount) || !inInbox {
		t.Fatalf("notification = %s (in inbox %v), want an account row in the inbox", category, inInbox)
	}
	var mails int
	if err := f.pg.DB.QueryRowContext(context.Background(), `
		SELECT count(*) FROM outbox_events WHERE event_type = $1 AND payload->>'subject_key' = $2
	`, outbox.EventTypeDataExportReadyEmail, outbox.DataExportSubjectKey(id)).Scan(&mails); err != nil {
		t.Fatalf("count the mail: %v", err)
	}
	if mails != 1 {
		t.Fatalf("notification mails queued = %d, want 1", mails)
	}

	if summary, err := dataexport.RunPending(context.Background(), dataexport.Deps{DB: f.pg.OpenContentStatsDB(t), Storage: bucket, Now: func() time.Time { return now }}); err != nil || summary != (dataexport.Summary{}) {
		t.Fatalf("second pass = %+v, %v, want nothing left to build", summary, err)
	}
}

// With no object store to keep it in, a request is given up on rather than
// retried forever, so the reader can ask again once there is one.
func TestRunPendingFailsARequestThereIsNoObjectStoreFor(t *testing.T) {
	t.Parallel()
	f := newExportFixture(t)
	id := f.request(t, f.reader)

	summary, err := dataexport.RunPending(context.Background(), dataexport.Deps{DB: f.pg.OpenContentStatsDB(t), Logger: slog.New(slog.DiscardHandler)})
	if err != nil || summary != (dataexport.Summary{Failed: 1}) {
		t.Fatalf("RunPending = %+v, %v, want one failed", summary, err)
	}
	if row := f.row(t, id); !row.FailedAt.Valid || row.ReadyAt.Valid || !row.ExpiresAt.Valid {
		t.Fatalf("data export = %+v, want failed and due for the purge", row)
	}
}

// A stored locale that names no supported language is a fault the archive
// must not hide by being written in the tenant's language instead, so the
// request fails, and nothing is stored.
func TestRunPendingFailsARequestWhoseStoredLocaleIsUnsupported(t *testing.T) {
	t.Parallel()
	f := newExportFixture(t)
	f.exec(t, `UPDATE users SET last_locale = 'tlh' WHERE id = $1`, f.reader.ID)
	id := f.request(t, f.reader)
	bucket := storagetest.NewMemory()

	summary, err := dataexport.RunPending(context.Background(), dataexport.Deps{DB: f.pg.OpenContentStatsDB(t), Storage: bucket, Logger: slog.New(slog.DiscardHandler)})
	if err != nil || summary != (dataexport.Summary{Failed: 1}) {
		t.Fatalf("RunPending = %+v, %v, want one failed", summary, err)
	}
	if row := f.row(t, id); !row.FailedAt.Valid || row.ReadyAt.Valid {
		t.Fatalf("data export = %+v, want failed", row)
	}
	if keys := bucket.Keys(); len(keys) != 0 {
		t.Fatalf("bucket = %v, want nothing stored", keys)
	}
}

// An archive is purged once its seven days are up, and at once with the
// account it was built for, archive and row alike; one still in its time is
// kept.
func TestPurgeTakesTheExpiredAndTheDeletedAccountsArchives(t *testing.T) {
	t.Parallel()
	f := newExportFixture(t)
	bucket := storagetest.NewMemory()
	built := time.Date(2026, 11, 2, 6, 0, 0, 0, time.UTC)
	build := func(user testutil.TenantUser) uuid.UUID {
		t.Helper()
		id := f.request(t, user)
		if _, err := dataexport.RunPending(context.Background(), dataexport.Deps{DB: f.pg.OpenContentStatsDB(t), Storage: bucket, Now: func() time.Time { return built }}); err != nil {
			t.Fatalf("RunPending: %v", err)
		}
		return id
	}
	expired := build(f.reader)
	kept := build(f.other)
	f.exec(t, `UPDATE user_data_exports SET expires_at = $1 WHERE id = $2`, built.Add(-time.Minute), expired)
	keptKey := f.row(t, kept).ObjectKey.String

	deleted := f.pg.SeedEndUser(t, f.tenant.ID, "EXPORTUSR003", "deleted@export.example.com", "Deleted")
	pendingOfDeleted := f.request(t, deleted)
	f.exec(t, `DELETE FROM users WHERE id = $1`, deleted.ID)
	if row := f.row(t, pendingOfDeleted); row.UserID.Valid {
		t.Fatalf("data export of a deleted account = %+v, want it to name no reader", row)
	}

	purgeDeps := dataexport.Deps{DB: f.pg.OpenContentStatsDB(t), Reclaimers: bucket, Now: func() time.Time { return built }}
	if counted, err := dataexport.Purge(context.Background(), purgeDeps, true); err != nil || counted != (dataexport.PurgeResult{Requests: 2, Archives: 1}) {
		t.Fatalf("dry run = %+v, %v, want the two requests counted", counted, err)
	}
	if keys := bucket.Keys(); len(keys) != 2 {
		t.Fatalf("bucket after a dry run = %v, want both archives kept", keys)
	}
	result, err := dataexport.Purge(context.Background(), purgeDeps, false)
	if err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if result != (dataexport.PurgeResult{Requests: 2, Archives: 1}) {
		t.Fatalf("Purge = %+v, want the expired request with its archive and the deleted account's", result)
	}
	if keys := bucket.Keys(); !slices.Equal(keys, []string{keptKey}) {
		t.Fatalf("bucket = %v, want only the archive still in its time", keys)
	}
	var left []uuid.UUID
	rows, err := f.pg.DB.QueryContext(context.Background(), `SELECT id FROM user_data_exports`)
	if err != nil {
		t.Fatalf("list data exports: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan: %v", err)
		}
		left = append(left, id)
	}
	if !slices.Equal(left, []uuid.UUID{kept}) {
		t.Fatalf("data exports = %v, want only %s", left, kept)
	}
}

// The orphan sweep deletes an object under a tenant's prefix that no row
// names, so an archive a row names has to be one it keeps.
func TestTheOrphanSweepKeepsAnArchiveARowNames(t *testing.T) {
	t.Parallel()
	f := newExportFixture(t)
	bucket := storagetest.NewMemory()
	id := f.request(t, f.reader)
	if _, err := dataexport.RunPending(context.Background(), dataexport.Deps{DB: f.pg.OpenContentStatsDB(t), Storage: bucket}); err != nil {
		t.Fatalf("RunPending: %v", err)
	}
	key := f.row(t, id).ObjectKey.String

	referenced, err := dbmodels.New(f.pg.OpenContentStatsDB(t)).ListReferencedObjectKeys(context.Background(), []string{key, "tenants/" + f.tenant.PublicID + "/data-exports/gone.zip"})
	if err != nil {
		t.Fatalf("ListReferencedObjectKeys: %v", err)
	}
	if !slices.Equal(referenced, []string{key}) {
		t.Fatalf("referenced = %v, want the archive the row names alone", referenced)
	}
}
