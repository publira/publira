package outbox

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fcmsettings"
	"github.com/publira/publira/server/internal/push"
)

func TestMemberPushNotificationSendsOneMessagePerDevice(t *testing.T) {
	tenantID := uuid.New()
	first := uuid.New()
	second := uuid.New()
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: first, UserID: uuid.New(), Token: "token-a", Platform: "android"},
		{NotificationID: second, UserID: uuid.New(), Token: "token-b", Platform: "ios"},
	}}
	sender := &stubPushSender{}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, defaultMemberPushPaging)
	if err := handler(context.Background(), memberPushEvent(t, tenantID, "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(sender.sent) != 2 {
		t.Fatalf("messages sent = %d, want 2", len(sender.sent))
	}
	if got := queries.listed.NotificationType; got != "episode_published" {
		t.Fatalf("listed notification_type = %q", got)
	}
	if got := queries.listed.SubjectKey; got != "episode:EPISODE00001" {
		t.Fatalf("listed subject_key = %q", got)
	}
	if queries.listed.TenantID != tenantID {
		t.Fatalf("listed tenant_id = %s, want %s", queries.listed.TenantID, tenantID)
	}
	for i, sentFor := range sender.tenants {
		if sentFor != tenantID {
			t.Fatalf("message %d sent with the credentials of %s, want %s", i, sentFor, tenantID)
		}
	}

	message := sender.sentTo(t, "token-a")
	if message.Title != "Seed Series" || message.Body != "Episode Three" {
		t.Fatalf("title/body = %q / %q", message.Title, message.Body)
	}
	want := map[string]string{
		"notification_id":   first.String(),
		"notification_type": "episode_published",
		"series_id":         "SERIES000001",
		"episode_id":        "EPISODE00001",
		"route":             "/series/SERIES000001/episodes/EPISODE00001",
	}
	for key, value := range want {
		if message.Data[key] != value {
			t.Fatalf("data[%q] = %q, want %q", key, message.Data[key], value)
		}
	}
	if len(message.Data) != len(want) {
		t.Fatalf("data = %v, want exactly %v", message.Data, want)
	}
	if got := sender.sentTo(t, "token-b").Data["notification_id"]; got != second.String() {
		t.Fatalf("second message mirrors %q, want %s", got, second)
	}
}

func TestMemberPushNotificationSendsWebPushAndDeletesGoneEndpoint(t *testing.T) {
	endpoint := "https://push.example.test/subscription"
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{{
		NotificationID: uuid.New(), UserID: uuid.New(), Token: endpoint, Platform: "web",
		Endpoint: sql.NullString{String: endpoint, Valid: true}, P256dh: sql.NullString{String: "p256dh", Valid: true}, Auth: sql.NullString{String: "auth", Valid: true},
	}}}
	sender := &stubWebPushSender{err: push.ErrEndpointGone}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{WebSender: sender}, queries, defaultMemberPushPaging)
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}
	// The keys are what the payload is encrypted to, so a swap between them is
	// a delivery no browser can open.
	want := push.WebPushSubscription{Endpoint: endpoint, P256dh: "p256dh", Auth: "auth"}
	if len(sender.sent) != 1 || sender.sent[0].subscription != want {
		t.Fatalf("web messages = %+v, want one for %+v", sender.sent, want)
	}
	if len(queries.deleted) != 1 || queries.deleted[0] != endpoint {
		t.Fatalf("deleted tokens = %v, want [%s]", queries.deleted, endpoint)
	}
}

// A tenant that has not connected a Firebase project has mobile push off: its
// app devices are skipped and kept, and its browsers are still notified.
func TestMemberPushNotificationSkipsMobileDevicesOfATenantWithoutFCM(t *testing.T) {
	endpoint := "https://push.example.test/subscription"
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-a", Platform: "android"},
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-b", Platform: "ios"},
		{
			NotificationID: uuid.New(), UserID: uuid.New(), Token: endpoint, Platform: "web",
			Endpoint: sql.NullString{String: endpoint, Valid: true}, P256dh: sql.NullString{String: "p256dh", Valid: true}, Auth: sql.NullString{String: "auth", Valid: true},
		},
	}}
	sender := &stubPushSender{errs: map[string]error{
		"token-a": fcmsettings.ErrNotConfigured,
		"token-b": fcmsettings.ErrNotConfigured,
	}}
	webSender := &stubWebPushSender{}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender, WebSender: webSender}, queries, defaultMemberPushPaging)
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(webSender.sent) != 1 {
		t.Fatalf("web messages = %d, want 1", len(webSender.sent))
	}
	if len(queries.deleted) != 0 {
		t.Fatalf("deleted tokens = %v, want none", queries.deleted)
	}
}

// With only app devices and no credentials there is nothing to deliver, which
// is not an outage to retry.
func TestMemberPushNotificationCompletesWhenTheTenantHasNoFCM(t *testing.T) {
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-a", Platform: "android"},
	}}
	sender := &stubPushSender{errs: map[string]error{"token-a": fcmsettings.ErrNotConfigured}}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, defaultMemberPushPaging)
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.deleted) != 0 {
		t.Fatalf("deleted tokens = %v, want none", queries.deleted)
	}
}

func TestMemberPushNotificationSkipsATypeThatIsNotPushed(t *testing.T) {
	for _, notificationType := range []string{
		"episode_publish_failed",
		NotificationTypeCommentApproved,
		NotificationTypeCommentHidden,
	} {
		t.Run(notificationType, func(t *testing.T) {
			queries := &stubPushDeviceQuerier{}
			sender := &stubPushSender{}

			handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, defaultMemberPushPaging)
			event := memberPushEvent(t, uuid.New(), notificationType)
			if err := handler(context.Background(), event); err != nil {
				t.Fatalf("handler: %v", err)
			}

			if queries.listCalls != 0 {
				t.Fatalf("device lookups = %d, want 0", queries.listCalls)
			}
			if len(sender.sent) != 0 {
				t.Fatalf("messages sent = %d, want 0", len(sender.sent))
			}
		})
	}
}

func TestMemberPushNotificationDeletesARevokedToken(t *testing.T) {
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "revoked", Platform: "android"},
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "live", Platform: "android"},
	}}
	sender := &stubPushSender{errs: map[string]error{"revoked": push.ErrTokenGone}}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, defaultMemberPushPaging)
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(queries.deleted) != 1 || queries.deleted[0] != "revoked" {
		t.Fatalf("deleted tokens = %v, want [revoked]", queries.deleted)
	}
}

func TestMemberPushNotificationRetriesWhenNothingWasDelivered(t *testing.T) {
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-a", Platform: "android"},
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-b", Platform: "android"},
	}}
	sender := &stubPushSender{errs: map[string]error{
		"token-a": errors.New("fcm is unavailable"),
		"token-b": errors.New("fcm is unavailable"),
	}}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, defaultMemberPushPaging)
	err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published"))
	if err == nil {
		t.Fatal("handler error = nil, want an error")
	}
	if IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable error", err)
	}
	if len(queries.deleted) != 0 {
		t.Fatalf("deleted tokens = %v, want none", queries.deleted)
	}
}

func TestMemberPushNotificationCompletesWhenSomeDevicesTookIt(t *testing.T) {
	// A retry would re-send to every device that already took the message,
	// once per remaining attempt of the retry budget. A run that reached
	// someone therefore completes, and the devices it could not reach lose
	// this alert rather than every other reader being notified ten times.
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-a", Platform: "android"},
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-b", Platform: "android"},
	}}
	sender := &stubPushSender{errs: map[string]error{"token-b": errors.New("fcm rate limit")}}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, defaultMemberPushPaging)
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(sender.sent) != 1 || sender.sent[0].Token != "token-a" {
		t.Fatalf("messages sent = %+v, want only token-a", sender.sent)
	}
}

func TestMemberPushNotificationCompletesWhenOnlyARevokedTokenFailed(t *testing.T) {
	// Deleting a revoked device settles it as surely as a delivery does, so an
	// event whose every device is revoked has nothing left to retry for.
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "revoked", Platform: "android"},
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-b", Platform: "android"},
	}}
	sender := &stubPushSender{errs: map[string]error{
		"revoked": push.ErrTokenGone,
		"token-b": errors.New("fcm rate limit"),
	}}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, defaultMemberPushPaging)
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.deleted) != 1 || queries.deleted[0] != "revoked" {
		t.Fatalf("deleted tokens = %v, want [revoked]", queries.deleted)
	}
}

func TestMemberPushNotificationPagesThroughEveryDevice(t *testing.T) {
	queries := &stubPushDeviceQuerier{devices: androidDevices("token-1", "token-2", "token-3", "token-4", "token-5")}
	sender := &stubPushSender{}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, testMemberPushPaging(2))
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}

	for _, token := range []string{"token-1", "token-2", "token-3", "token-4", "token-5"} {
		sender.sentTo(t, token)
	}
	if queries.listCalls != 3 {
		t.Fatalf("pages listed = %d, want 3", queries.listCalls)
	}
	if got, want := queries.progressTokens(t), []string{"token-2", "token-4"}; !slices.Equal(got, want) {
		t.Fatalf("recorded cursors = %v, want %v", got, want)
	}
}

// A job whose time is too short for another page hands the event back with
// its cursor recorded, and the next job carries on from it. Every device takes
// the message once however many jobs it took.
func TestMemberPushNotificationResumesAcrossJobs(t *testing.T) {
	tokens := []string{"token-1", "token-2", "token-3", "token-4", "token-5"}
	queries := &stubPushDeviceQuerier{devices: androidDevices(tokens...)}
	sender := &stubPushSender{}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, testMemberPushPaging(2))

	event := memberPushEvent(t, uuid.New(), "episode_published")
	runs := 0
	for {
		runs++
		if runs > 5 {
			t.Fatal("the event did not finish within five jobs")
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := handler(ctx, event)
		cancel()
		if err == nil {
			break
		}
		if !errors.Is(err, ErrResume) {
			t.Fatalf("run %d: handler error = %v, want ErrResume", runs, err)
		}
		event.ProgressCursor = sql.NullString{String: queries.progress[len(queries.progress)-1], Valid: true}
	}

	if runs != 3 {
		t.Fatalf("jobs = %d, want one per page (3)", runs)
	}
	for _, token := range tokens {
		sender.sentTo(t, token)
	}
}

// A run that settles nothing is retried from the cursor it started at, which
// is past every device an earlier run reached.
func TestMemberPushNotificationRetryStartsAfterTheDevicesAlreadyReached(t *testing.T) {
	queries := &stubPushDeviceQuerier{devices: androidDevices("token-1", "token-2", "token-3", "token-4")}
	sender := &stubPushSender{}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, testMemberPushPaging(2))
	event := memberPushEvent(t, uuid.New(), "episode_published")

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := handler(ctx, event); !errors.Is(err, ErrResume) {
		t.Fatalf("first run error = %v, want ErrResume", err)
	}
	event.ProgressCursor = sql.NullString{String: queries.progress[0], Valid: true}

	outage := errors.New("fcm is unavailable")
	sender.errs = map[string]error{"token-3": outage, "token-4": outage}
	err := handler(context.Background(), event)
	if err == nil || errors.Is(err, ErrResume) || IsPermanent(err) {
		t.Fatalf("second run error = %v, want a retriable error", err)
	}
	if got, want := queries.progressTokens(t), []string{"token-2"}; !slices.Equal(got, want) {
		t.Fatalf("recorded cursors = %v, want %v: a run that settled nothing moved the cursor", got, want)
	}

	sender.errs = nil
	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("third run: %v", err)
	}
	for _, token := range []string{"token-1", "token-2", "token-3", "token-4"} {
		sender.sentTo(t, token)
	}
}

// Every send of a page is in flight at once: the sender below answers none of
// them until the whole page has arrived, which a loop that waits for one send
// before starting the next never reaches.
func TestMemberPushNotificationSendsAPageConcurrently(t *testing.T) {
	const pageSize = 4
	queries := &stubPushDeviceQuerier{devices: androidDevices("token-1", "token-2", "token-3", "token-4")}
	sender := &barrierPushSender{want: pageSize, arrived: make(chan struct{})}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, memberPushPaging{
		pageSize:    pageSize,
		sendTimeout: 5 * time.Second,
	})

	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}
}

// Two devices of one reader can fall either side of a page boundary: the cursor
// names the device as well as the reader, so the next page starts between them.
func TestMemberPushNotificationSplitsOneReadersDevicesAcrossPages(t *testing.T) {
	reader := uuid.UUID{15: 1}
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: reader, Token: "token-a", Platform: "android"},
		{NotificationID: uuid.New(), UserID: reader, Token: "token-b", Platform: "android"},
		{NotificationID: uuid.New(), UserID: reader, Token: "token-c", Platform: "android"},
	}}
	sender := &stubPushSender{}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries, testMemberPushPaging(2))

	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}
	for _, token := range []string{"token-a", "token-b", "token-c"} {
		sender.sentTo(t, token)
	}
}

func TestMemberPushNotificationRejectsAnUnreadableCursor(t *testing.T) {
	queries := &stubPushDeviceQuerier{devices: androidDevices("token-1")}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: &stubPushSender{}}, queries, defaultMemberPushPaging)

	event := memberPushEvent(t, uuid.New(), "episode_published")
	event.ProgressCursor = sql.NullString{String: "token-1", Valid: true}
	if err := handler(context.Background(), event); !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
}

func TestMemberPushNotificationRejectsAPayloadNamingAnotherTenant(t *testing.T) {
	queries := &stubPushDeviceQuerier{}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: &stubPushSender{}}, queries, defaultMemberPushPaging)

	event := memberPushEvent(t, uuid.New(), "episode_published")
	event.TenantID = uuid.NullUUID{UUID: uuid.New(), Valid: true}
	err := handler(context.Background(), event)
	if !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
}

func memberPushEvent(t *testing.T, tenantID uuid.UUID, notificationType string) dbmodels.OutboxEvent {
	t.Helper()
	payload, err := json.Marshal(MemberPushNotificationPayload{
		TenantID:         tenantID.String(),
		NotificationType: notificationType,
		SubjectKey:       "episode:EPISODE00001",
		SeriesID:         "SERIES000001",
		SeriesTitle:      "Seed Series",
		EpisodeID:        "EPISODE00001",
		EpisodeTitle:     "Episode Three",
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.New(),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      EventTypeMemberPushNotification,
		Payload:        payload,
		IdempotencyKey: "push:" + notificationType + ":episode:EPISODE00001",
		Status:         StatusProcessing,
	}
}

type stubPushDeviceQuerier struct {
	mu        sync.Mutex
	devices   []dbmodels.ListPushDevicesForNotificationRow
	listed    dbmodels.ListPushDevicesForNotificationParams
	listCalls int
	deleted   []string
	progress  []string
}

// ListPushDevicesForNotification pages the way the statement does: by recipient
// and token, after the cursor, at most one page.
func (s *stubPushDeviceQuerier) ListPushDevicesForNotification(
	_ context.Context,
	arg dbmodels.ListPushDevicesForNotificationParams,
) ([]dbmodels.ListPushDevicesForNotificationRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listCalls++
	s.listed = arg
	devices := slices.Clone(s.devices)
	slices.SortFunc(devices, compareRecipientAndToken)
	after := dbmodels.ListPushDevicesForNotificationRow{UserID: arg.AfterUserID, Token: arg.AfterToken}
	var page []dbmodels.ListPushDevicesForNotificationRow
	for _, device := range devices {
		if compareRecipientAndToken(device, after) > 0 && len(page) < int(arg.PageSize) {
			page = append(page, device)
		}
	}
	return page, nil
}

func compareRecipientAndToken(a, b dbmodels.ListPushDevicesForNotificationRow) int {
	if byUser := bytes.Compare(a.UserID[:], b.UserID[:]); byUser != 0 {
		return byUser
	}
	return strings.Compare(a.Token, b.Token)
}

// progressTokens is the token of every cursor the handler recorded.
func (s *stubPushDeviceQuerier) progressTokens(t *testing.T) []string {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	tokens := make([]string, 0, len(s.progress))
	for _, recorded := range s.progress {
		var cursor memberPushCursor
		if err := json.Unmarshal([]byte(recorded), &cursor); err != nil {
			t.Fatalf("decode recorded cursor %q: %v", recorded, err)
		}
		tokens = append(tokens, cursor.Token)
	}
	return tokens
}

func (s *stubPushDeviceQuerier) DeleteUserPushDeviceByToken(_ context.Context, token string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleted = append(s.deleted, token)
	return 1, nil
}

func (s *stubPushDeviceQuerier) RecordOutboxEventProgress(_ context.Context, arg dbmodels.RecordOutboxEventProgressParams) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.progress = append(s.progress, arg.ProgressCursor.String)
	return 1, nil
}

type stubPushSender struct {
	mu      sync.Mutex
	sent    []push.Message
	tenants []uuid.UUID
	errs    map[string]error
}

func (s *stubPushSender) Send(_ context.Context, tenantID uuid.UUID, message push.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err, ok := s.errs[message.Token]; ok {
		return err
	}
	s.sent = append(s.sent, message)
	s.tenants = append(s.tenants, tenantID)
	return nil
}

// sentTo is the one message the device took, failing when it took none or
// more than one.
func (s *stubPushSender) sentTo(t *testing.T, token string) push.Message {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	var found []push.Message
	for _, message := range s.sent {
		if message.Token == token {
			found = append(found, message)
		}
	}
	if len(found) != 1 {
		t.Fatalf("messages sent to %q = %d, want 1", token, len(found))
	}
	return found[0]
}

// androidDevices gives each token a recipient of its own, numbered in the order
// given, so the pages follow that order.
func androidDevices(tokens ...string) []dbmodels.ListPushDevicesForNotificationRow {
	devices := make([]dbmodels.ListPushDevicesForNotificationRow, 0, len(tokens))
	for i, token := range tokens {
		devices = append(devices, dbmodels.ListPushDevicesForNotificationRow{
			NotificationID: uuid.New(), UserID: uuid.UUID{15: byte(i + 1)}, Token: token, Platform: "android",
		})
	}
	return devices
}

// testMemberPushPaging leaves a job room for its first page only when the
// test gives it a deadline, and for every page when it does not.
func testMemberPushPaging(pageSize int32) memberPushPaging {
	return memberPushPaging{pageSize: pageSize, sendTimeout: 5 * time.Second, reserve: 5 * time.Second}
}

// barrierPushSender holds every send until want of them are in flight.
type barrierPushSender struct {
	mu      sync.Mutex
	want    int
	count   int
	arrived chan struct{}
}

func (s *barrierPushSender) Send(ctx context.Context, _ uuid.UUID, _ push.Message) error {
	s.mu.Lock()
	s.count++
	if s.count == s.want {
		close(s.arrived)
	}
	s.mu.Unlock()
	select {
	case <-s.arrived:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type sentWebPush struct {
	subscription push.WebPushSubscription
	message      push.WebPushMessage
}

type stubWebPushSender struct {
	mu   sync.Mutex
	sent []sentWebPush
	err  error
}

func (s *stubWebPushSender) Send(_ context.Context, subscription push.WebPushSubscription, message push.WebPushMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, sentWebPush{subscription: subscription, message: message})
	return s.err
}
