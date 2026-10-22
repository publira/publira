package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/tenantorigin"
)

// stubNotificationEmailQuerier answers recipients the way the query walks
// them: in user_id order after the cursor, leaving out the rows already
// marked emailed.
type stubNotificationEmailQuerier struct {
	recipients []dbmodels.ListNotificationEmailRecipientsRow
	emailed    map[uuid.UUID]bool
	recorded   []sql.NullString
	listCalls  int
}

func (s *stubNotificationEmailQuerier) ListNotificationEmailRecipients(
	_ context.Context,
	arg dbmodels.ListNotificationEmailRecipientsParams,
) ([]dbmodels.ListNotificationEmailRecipientsRow, error) {
	s.listCalls++
	var page []dbmodels.ListNotificationEmailRecipientsRow
	for _, recipient := range s.recipients {
		if strings.Compare(recipient.UserID.String(), arg.AfterUserID.String()) <= 0 || s.emailed[recipient.NotificationID] {
			continue
		}
		page = append(page, recipient)
		if int32(len(page)) == arg.PageSize {
			break
		}
	}
	return page, nil
}

func (s *stubNotificationEmailQuerier) MarkNotificationEmailed(_ context.Context, arg dbmodels.MarkNotificationEmailedParams) error {
	if s.emailed == nil {
		s.emailed = map[uuid.UUID]bool{}
	}
	s.emailed[arg.ID] = true
	return nil
}

func (s *stubNotificationEmailQuerier) RecordOutboxEventProgress(_ context.Context, arg dbmodels.RecordOutboxEventProgressParams) (int64, error) {
	s.recorded = append(s.recorded, arg.ProgressCursor)
	return 1, nil
}

// failingRecipientMailer answers the addresses in fail with their error and
// records the rest as sent.
type failingRecipientMailer struct {
	fail  map[string]error
	sent  []string
	mails []internalsmtp.RenderedEmail
}

var (
	errRelayDown          = errors.New("dial tcp: connection refused")
	errRefusedForNow      = &internalsmtp.RecipientRefusedError{Code: 452, Err: errors.New("452 mailbox full")}
	errRefusedPermanently = &internalsmtp.RecipientRefusedError{Code: 550, Err: errors.New("550 mailbox unavailable")}
)

func (m *failingRecipientMailer) SendRenderedEmail(_ context.Context, _ emailsettings.SMTPSettings, recipient string, email internalsmtp.RenderedEmail) error {
	if err := m.fail[recipient]; err != nil {
		return err
	}
	m.sent = append(m.sent, recipient)
	m.mails = append(m.mails, email)
	return nil
}

// notificationEmailRecipients is one episode_published row per address, in
// the user_id order the query answers them in.
func notificationEmailRecipients(t *testing.T, addresses ...string) []dbmodels.ListNotificationEmailRecipientsRow {
	t.Helper()
	payload, err := json.Marshal(EpisodePublishedNotificationBody{
		EpisodeID: "EPISODE00001", EpisodeTitle: "The First Night",
		SeriesID: "SERIES000001", SeriesTitle: "The Lighthouse Keeper",
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	rows := make([]dbmodels.ListNotificationEmailRecipientsRow, 0, len(addresses))
	for _, address := range addresses {
		rows = append(rows, dbmodels.ListNotificationEmailRecipientsRow{
			NotificationID: uuid.Must(uuid.NewV7()),
			UserID:         uuid.Must(uuid.NewV7()),
			Category:       string(NotificationCategoryFollowedEpisodes),
			Payload:        payload,
			Email:          address,
		})
	}
	return rows
}

func notificationEmailEvent(t *testing.T, tenantID uuid.UUID, notificationType string, cursor *notificationEmailCursor) dbmodels.OutboxEvent {
	t.Helper()
	payload, err := json.Marshal(NotificationEmailPayload{
		TenantID:         tenantID.String(),
		NotificationType: notificationType,
		SubjectKey:       "episode:EPISODE00001",
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	event := dbmodels.OutboxEvent{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType: EventTypeNotificationEmail,
		Payload:   payload,
	}
	if cursor != nil {
		encoded, err := json.Marshal(cursor)
		if err != nil {
			t.Fatalf("encode cursor: %v", err)
		}
		event.ProgressCursor = sql.NullString{String: string(encoded), Valid: true}
	}
	return event
}

func notificationEmailTestHandler(mailer internalsmtp.RenderedSender, queries notificationEmailQuerier, paging notificationEmailPaging) Handler {
	resolve := func(context.Context, uuid.UUID) (tenantDelivery, error) {
		return tenantDelivery{
			locale:     "en",
			tenant:     dbmodels.Tenant{Domain: "aoto.example.test"},
			tenantName: "Aoto Press",
			timeZone:   "UTC",
		}, nil
	}
	return newNotificationEmailHandler(EmailHandlerConfig{DB: &sql.DB{}, Mailer: mailer}, queries, resolve, paging)
}

func TestNotificationEmailMailsEveryRecipientOnceAcrossPages(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "https")
	queries := &stubNotificationEmailQuerier{recipients: notificationEmailRecipients(t, "a@example.test", "b@example.test", "c@example.test")}
	mailer := &failingRecipientMailer{}
	handler := notificationEmailTestHandler(mailer, queries, notificationEmailPaging{pageSize: 2, sendTimeout: time.Second})

	if err := handler(context.Background(), notificationEmailEvent(t, uuid.New(), NotificationTypeEpisodePublished, nil)); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if want := []string{"a@example.test", "b@example.test", "c@example.test"}; !slices.Equal(mailer.sent, want) {
		t.Fatalf("mailed %v, want %v", mailer.sent, want)
	}
	if len(queries.emailed) != 3 {
		t.Fatalf("rows marked emailed = %d, want 3", len(queries.emailed))
	}
	mail := mailer.mails[0]
	if mail.Subject != "New episode of The Lighthouse Keeper" {
		t.Fatalf("subject = %q", mail.Subject)
	}
	for _, link := range []string{
		"https://aoto.example.test/series/SERIES000001/episodes/EPISODE00001",
		"https://aoto.example.test/settings/notifications",
	} {
		if !strings.Contains(mail.Text, link) {
			t.Errorf("the mail does not link %s:\n%s", link, mail.Text)
		}
	}

	// A second run over the same event, which is what a redelivery looks
	// like, finds every row marked and mails nobody.
	mailer.sent = nil
	if err := handler(context.Background(), notificationEmailEvent(t, uuid.New(), NotificationTypeEpisodePublished, nil)); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if len(mailer.sent) != 0 {
		t.Fatalf("second run mailed %v, want nobody", mailer.sent)
	}
}

// A recipient the relay refuses for now fails the event once the rest are
// mailed, and the cursor starts over so the retry asks about them again; the
// rows already mailed are marked, so the retry mails nobody twice.
func TestNotificationEmailRetriesOnlyTheRecipientsItFailed(t *testing.T) {
	queries := &stubNotificationEmailQuerier{recipients: notificationEmailRecipients(t, "a@example.test", "bounce@example.test", "c@example.test")}
	mailer := &failingRecipientMailer{fail: map[string]error{"bounce@example.test": errRefusedForNow}}
	handler := notificationEmailTestHandler(mailer, queries, defaultNotificationEmailPaging)
	tenantID := uuid.New()

	err := handler(context.Background(), notificationEmailEvent(t, tenantID, NotificationTypeEpisodePublished, nil))
	if err == nil || IsPermanent(err) {
		t.Fatalf("handler err = %v, want a retriable failure", err)
	}
	if want := []string{"a@example.test", "c@example.test"}; !slices.Equal(mailer.sent, want) {
		t.Fatalf("mailed %v, want %v", mailer.sent, want)
	}
	if len(queries.recorded) != 1 || queries.recorded[0].Valid {
		t.Fatalf("recorded cursors = %+v, want the cursor cleared once", queries.recorded)
	}

	mailer.sent = nil
	mailer.fail = nil
	if err := handler(context.Background(), notificationEmailEvent(t, tenantID, NotificationTypeEpisodePublished, nil)); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if want := []string{"bounce@example.test"}; !slices.Equal(mailer.sent, want) {
		t.Fatalf("retry mailed %v, want %v", mailer.sent, want)
	}
}

// A recipient refused for good is passed over: the rest are mailed, and the
// event is done rather than retried for a mailbox that will not take it.
func TestNotificationEmailPassesOverARecipientRefusedForGood(t *testing.T) {
	queries := &stubNotificationEmailQuerier{recipients: notificationEmailRecipients(t, "a@example.test", "gone@example.test", "c@example.test")}
	mailer := &failingRecipientMailer{fail: map[string]error{"gone@example.test": errRefusedPermanently}}
	handler := notificationEmailTestHandler(mailer, queries, defaultNotificationEmailPaging)

	if err := handler(context.Background(), notificationEmailEvent(t, uuid.New(), NotificationTypeEpisodePublished, nil)); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if want := []string{"a@example.test", "c@example.test"}; !slices.Equal(mailer.sent, want) {
		t.Fatalf("mailed %v, want %v", mailer.sent, want)
	}
	if len(queries.emailed) != 2 {
		t.Fatalf("rows marked emailed = %d, want 2", len(queries.emailed))
	}
}

// A refusal is the relay answering for one mailbox, so a run that could afford
// only that one mail moves past it instead of handing the event back where it
// found it, and the recipients after it are mailed.
func TestNotificationEmailMovesPastARecipientRefusedFirst(t *testing.T) {
	recipients := notificationEmailRecipients(t, "bounce@example.test", "b@example.test")
	queries := &stubNotificationEmailQuerier{recipients: recipients}
	mailer := &failingRecipientMailer{fail: map[string]error{"bounce@example.test": errRefusedForNow}}
	handler := notificationEmailTestHandler(mailer, queries, notificationEmailPaging{pageSize: 10, sendTimeout: time.Hour})

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	err := handler(ctx, notificationEmailEvent(t, uuid.New(), NotificationTypeEpisodePublished, nil))
	if !errors.Is(err, ErrResume) {
		t.Fatalf("handler err = %v, want ErrResume", err)
	}
	if len(queries.recorded) != 1 {
		t.Fatalf("recorded cursors = %d, want 1", len(queries.recorded))
	}
	cursor, err := parseNotificationEmailCursor(queries.recorded[0])
	if err != nil {
		t.Fatalf("parse cursor: %v", err)
	}
	if cursor.UserID != recipients[0].UserID || !cursor.Failed {
		t.Fatalf("cursor = %+v, want after %s with the pass failed", cursor, recipients[0].UserID)
	}

	// The second run reaches the end of the pass the first one failed in, so
	// it fails for the retry to ask about the refused recipient again.
	err = handler(ctx, notificationEmailEvent(t, uuid.New(), NotificationTypeEpisodePublished, &cursor))
	if err == nil || IsPermanent(err) || errors.Is(err, ErrResume) {
		t.Fatalf("second run err = %v, want a retriable failure", err)
	}
	if want := []string{"b@example.test"}; !slices.Equal(mailer.sent, want) {
		t.Fatalf("mailed %v, want %v", mailer.sent, want)
	}
}

// A run is given the job's timeout, and the default budget of one mail leaves
// room in it for more than the first.
func TestNotificationEmailSendsMoreThanOneMailWithinAJob(t *testing.T) {
	queries := &stubNotificationEmailQuerier{recipients: notificationEmailRecipients(t, "a@example.test", "b@example.test", "c@example.test")}
	mailer := &failingRecipientMailer{}
	handler := notificationEmailTestHandler(mailer, queries, defaultNotificationEmailPaging)

	ctx, cancel := context.WithTimeout(context.Background(), defaultJobTimeout)
	defer cancel()
	if err := handler(ctx, notificationEmailEvent(t, uuid.New(), NotificationTypeEpisodePublished, nil)); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if want := []string{"a@example.test", "b@example.test", "c@example.test"}; !slices.Equal(mailer.sent, want) {
		t.Fatalf("mailed %v, want %v", mailer.sent, want)
	}
}

// A run whose every mail fails short of the relay answering for a recipient
// is a relay that is down: the cursor stays where the run found it, so the
// retry asks about the same recipients.
func TestNotificationEmailLeavesTheCursorWhenEveryMailFails(t *testing.T) {
	queries := &stubNotificationEmailQuerier{recipients: notificationEmailRecipients(t, "a@example.test", "b@example.test")}
	mailer := &failingRecipientMailer{fail: map[string]error{"a@example.test": errRelayDown, "b@example.test": errRelayDown}}
	handler := notificationEmailTestHandler(mailer, queries, defaultNotificationEmailPaging)

	err := handler(context.Background(), notificationEmailEvent(t, uuid.New(), NotificationTypeEpisodePublished, nil))
	if err == nil || IsPermanent(err) {
		t.Fatalf("handler err = %v, want a retriable failure", err)
	}
	if len(queries.recorded) != 0 {
		t.Fatalf("recorded cursors = %+v, want none", queries.recorded)
	}
}

// A run out of time hands the event back with the last recipient it asked
// about, and the next run carries on after them.
func TestNotificationEmailResumesAfterTheLastRecipientWhenOutOfTime(t *testing.T) {
	recipients := notificationEmailRecipients(t, "a@example.test", "b@example.test")
	queries := &stubNotificationEmailQuerier{recipients: recipients}
	mailer := &failingRecipientMailer{}
	paging := notificationEmailPaging{pageSize: 10, sendTimeout: time.Hour}
	handler := notificationEmailTestHandler(mailer, queries, paging)

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	err := handler(ctx, notificationEmailEvent(t, uuid.New(), NotificationTypeEpisodePublished, nil))
	if !errors.Is(err, ErrResume) {
		t.Fatalf("handler err = %v, want ErrResume", err)
	}
	if want := []string{"a@example.test"}; !slices.Equal(mailer.sent, want) {
		t.Fatalf("mailed %v, want %v", mailer.sent, want)
	}
	if len(queries.recorded) != 1 {
		t.Fatalf("recorded cursors = %d, want 1", len(queries.recorded))
	}
	cursor, err := parseNotificationEmailCursor(queries.recorded[0])
	if err != nil {
		t.Fatalf("parse cursor: %v", err)
	}
	if cursor.UserID != recipients[0].UserID || cursor.Failed {
		t.Fatalf("cursor = %+v, want after %s with nothing failed", cursor, recipients[0].UserID)
	}
}

// A pass that failed somebody in an earlier run still fails at its end, so the
// recipient that run could not reach is asked about again.
func TestNotificationEmailFailsAPassAnEarlierRunFailedIn(t *testing.T) {
	queries := &stubNotificationEmailQuerier{recipients: notificationEmailRecipients(t, "a@example.test")}
	mailer := &failingRecipientMailer{}
	handler := notificationEmailTestHandler(mailer, queries, defaultNotificationEmailPaging)

	err := handler(context.Background(), notificationEmailEvent(t, uuid.New(), NotificationTypeEpisodePublished, &notificationEmailCursor{Failed: true}))
	if err == nil || IsPermanent(err) {
		t.Fatalf("handler err = %v, want a retriable failure", err)
	}
	if len(queries.recorded) != 1 || queries.recorded[0].Valid {
		t.Fatalf("recorded cursors = %+v, want the cursor cleared once", queries.recorded)
	}
}

func TestNotificationEmailRefusesATypeThatIsNotMailed(t *testing.T) {
	queries := &stubNotificationEmailQuerier{}
	handler := notificationEmailTestHandler(&failingRecipientMailer{}, queries, defaultNotificationEmailPaging)

	err := handler(context.Background(), notificationEmailEvent(t, uuid.New(), NotificationTypeCommentAwaitingApproval, nil))
	if !IsPermanent(err) {
		t.Fatalf("handler err = %v, want a permanent failure", err)
	}
	if queries.listCalls != 0 {
		t.Fatalf("recipient pages read = %d, want none", queries.listCalls)
	}
}
