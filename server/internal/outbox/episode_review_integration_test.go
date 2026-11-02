package outbox_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

// episodeReviewReturnedEnv is a tenant with SMTP configured and one episode
// whose review round a Tenant admin sent back to submitter.
type episodeReviewReturnedEnv struct {
	pg        *testutil.PostgresEnv
	encryptor emailsettings.SecretManager
	tenantID  uuid.UUID
	reviewID  uuid.UUID
}

func newEpisodeReviewReturnedEnv(t *testing.T, ctx context.Context, prefix string, submitterRole string) (episodeReviewReturnedEnv, testutil.TenantUser) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, prefix+"T1", strings.ToLower(prefix)+".example.com", "Aoto Press")
	queries := dbmodels.New(pg.DB)

	encryptor, err := secretcrypto.NewManager(map[string][]byte{"test": make([]byte, 32)}, "test")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	password, err := encryptor.EncryptString("smtp-password")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := queries.InsertPlatformSMTPConfig(ctx, dbmodels.InsertPlatformSMTPConfigParams{
		Host: "smtp.example.com", Port: 587, Username: "mailer", PasswordEncrypted: password,
		Encryption: "starttls", FromAddress: "no-reply@example.com",
	}); err != nil {
		t.Fatalf("InsertPlatformSMTPConfig: %v", err)
	}

	admin := pg.SeedTenantAdmin(t, tenant.ID, prefix+"ADM1", "admin@aoto.example.com", "Admin")
	submitter := pg.SeedTenantUser(t, tenant.ID, prefix+"SUB1", "editor@aoto.example.com", "Editor", submitterRole)
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: prefix + "SER001", Title: "The Lighthouse Keeper", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EP0001", Title: "The First Night", Status: testutil.EpisodeStatusScheduled, ScheduledAt: time.Now().Add(24 * time.Hour),
	})
	reviewID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO episode_reviews (id, tenant_id, episode_id, submitted_by_user_id, decision, decided_by_user_id, decided_at, comment)
		VALUES ($1, $2, $3, $4, 'returned', $5, NOW(), $6)`,
		reviewID, tenant.ID, episode.ID, submitter.ID, admin.ID, "The speech bubble on page 4 is cut off."); err != nil {
		t.Fatalf("seed the returned round: %v", err)
	}
	return episodeReviewReturnedEnv{pg: pg, encryptor: encryptor, tenantID: tenant.ID, reviewID: reviewID}, submitter
}

func (e episodeReviewReturnedEnv) event(t *testing.T) dbmodels.OutboxEvent {
	t.Helper()
	payload, err := json.Marshal(outbox.EpisodeReviewReturnedNotificationPayload{
		TenantID: e.tenantID.String(),
		ReviewID: e.reviewID.String(),
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: e.tenantID, Valid: true},
		EventType:      outbox.EventTypeEpisodeReviewReturnedNotification,
		Payload:        payload,
		IdempotencyKey: outbox.EpisodeReviewReturnedIdempotencyKey(e.reviewID),
	}
}

func (e episodeReviewReturnedEnv) handler(mailer *recordingMailer) outbox.Handler {
	return outbox.NewEpisodeReviewReturnedNotificationHandler(outbox.EmailHandlerConfig{
		DB: e.pg.DB, Encryptor: e.encryptor, Mailer: mailer,
	})
}

func (e episodeReviewReturnedEnv) notificationCount(t *testing.T, ctx context.Context, userID uuid.UUID) int {
	t.Helper()
	var count int
	if err := e.pg.DB.QueryRowContext(ctx,
		`SELECT count(*) FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND notification_type = $3 AND category = 'staff' AND in_inbox`,
		e.tenantID, userID, outbox.NotificationTypeEpisodeReviewReturned).Scan(&count); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	return count
}

// The member of staff who submitted the episode is told, in the console's bell
// and by mail, and the mail carries the comment and a link to the episode in
// the console. A redelivered event files no second row.
func TestEpisodeReviewReturnedNotificationTellsTheSubmitter(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env, submitter := newEpisodeReviewReturnedEnv(t, ctx, "OBRRET", "tenant_editor")
	mailer := &recordingMailer{}
	handler := env.handler(mailer)
	for range 2 {
		if err := handler(ctx, env.event(t)); err != nil {
			t.Fatalf("episode review returned handler: %v", err)
		}
	}

	if got := env.notificationCount(t, ctx, submitter.ID); got != 1 {
		t.Fatalf("bell rows for the submitter = %d, want 1", got)
	}
	if got := mailer.recipients(); len(got) != 2 || got[0] != "editor@aoto.example.com" || got[1] != "editor@aoto.example.com" {
		t.Fatalf("mailed %v, want the submitter on each delivery", got)
	}
	sent := mailer.sent[0].email
	if !strings.Contains(sent.Subject, "The First Night") {
		t.Errorf("subject = %q", sent.Subject)
	}
	for _, fragment := range []string{
		"The speech bubble on page 4 is cut off.",
		"The Lighthouse Keeper",
		"http://admin-obrret.example.com/series/OBRRETSER001/episodes/OBRRETEP0001",
	} {
		if !strings.Contains(sent.Text, fragment) {
			t.Errorf("the mail does not carry %q:\n%s", fragment, sent.Text)
		}
	}
}

// A submitter who is no longer a member of the tenant's staff cannot open the
// episode the notice points at, so nobody is told.
func TestEpisodeReviewReturnedNotificationSkipsASubmitterWhoLeftTheStaff(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env, submitter := newEpisodeReviewReturnedEnv(t, ctx, "OBRLFT", "tenant_editor")
	if _, err := env.pg.DB.ExecContext(ctx, `DELETE FROM tenant_user_roles WHERE user_id = $1`, submitter.ID); err != nil {
		t.Fatalf("remove the submitter from the staff: %v", err)
	}
	mailer := &recordingMailer{}
	if err := env.handler(mailer)(ctx, env.event(t)); err != nil {
		t.Fatalf("episode review returned handler: %v", err)
	}
	if got := env.notificationCount(t, ctx, submitter.ID); got != 0 {
		t.Fatalf("bell rows = %d, want none", got)
	}
	if got := mailer.recipients(); len(got) != 0 {
		t.Fatalf("mailed %v, want nobody", got)
	}
}
