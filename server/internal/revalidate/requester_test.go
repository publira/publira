package revalidate

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
)

// recordingQuerier keeps the outbox rows a requester writes.
type recordingQuerier struct {
	mu     sync.Mutex
	events []dbmodels.InsertOutboxEventParams
}

func (q *recordingQuerier) InsertOutboxEvent(
	_ context.Context,
	arg dbmodels.InsertOutboxEventParams,
) (dbmodels.OutboxEvent, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.events = append(q.events, arg)
	return dbmodels.OutboxEvent{ID: arg.ID, TenantID: arg.TenantID, EventType: arg.EventType}, nil
}

func (q *recordingQuerier) recorded() []dbmodels.InsertOutboxEventParams {
	q.mu.Lock()
	defer q.mu.Unlock()
	return slices.Clone(q.events)
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// newRecordingApps points all three targets at one server that collects the
// tags it is asked to drop and answers as answer says.
func newRecordingApps(t *testing.T, answer func(w http.ResponseWriter)) *revalidationLog {
	t.Helper()
	log := &revalidationLog{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload requestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode revalidate payload: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		log.add(payload.Tags)
		answer(w)
	}))
	t.Cleanup(server.Close)
	setInternalURLs(t, server.URL, server.URL, server.URL)
	return log
}

type revalidationLog struct {
	mu   sync.Mutex
	tags [][]string
}

func (l *revalidationLog) add(tags []string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.tags = append(l.tags, tags)
}

func (l *revalidationLog) calls() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.tags)
}

// waitForCalls waits for the three apps to have been asked, since the attempt
// no longer happens on the caller's goroutine.
func (l *revalidationLog) waitForCalls(t *testing.T, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if l.calls() >= want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("revalidate requests = %d, want %d", l.calls(), want)
}

func newTestClient(t *testing.T) *Client {
	t.Helper()
	client, err := NewClient("test-token", quietLogger())
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	return client
}

func TestRecordWritesTheInvalidationAsATenantOutboxEvent(t *testing.T) {
	setInternalURLs(t, "http://web-host:3000", "http://web-admin:3100", "http://web-platform:4100")
	queries := &recordingQuerier{}
	requester := NewRequester(RequesterConfig{Client: newTestClient(t), Queries: queries, Logger: quietLogger()})
	tenantID := uuid.Must(uuid.NewV7())

	owed, err := requester.Record(context.Background(), nil, tenantID, []string{" tenant:t:site ", "tenant:t:site", "tenant:t:pages"})
	if err != nil {
		t.Fatalf("Record() error = %v", err)
	}

	recorded := queries.recorded()
	if len(recorded) != 1 {
		t.Fatalf("recorded %d events, want 1", len(recorded))
	}
	event := recorded[0]
	if event.EventType != outbox.EventTypeNextCacheRevalidation {
		t.Errorf("event type = %q, want %q", event.EventType, outbox.EventTypeNextCacheRevalidation)
	}
	if event.TenantID != (uuid.NullUUID{UUID: tenantID, Valid: true}) {
		t.Errorf("tenant = %v, want %s", event.TenantID, tenantID)
	}
	if event.IdempotencyKey != outbox.EventTypeNextCacheRevalidation+":"+event.ID.String() {
		t.Errorf("idempotency key = %q, want the event's own id", event.IdempotencyKey)
	}
	var payload outbox.NextCacheRevalidationPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatalf("decode recorded payload: %v", err)
	}
	// The table holds a tenant event's payload to the row it belongs to.
	if payload.TenantID != tenantID.String() {
		t.Errorf("payload tenant = %q, want %s", payload.TenantID, tenantID)
	}
	if want := []string{"tenant:t:site", "tenant:t:pages"}; !slices.Equal(payload.Tags, want) {
		t.Errorf("payload tags = %v, want %v", payload.Tags, want)
	}
	if owed.tags == nil {
		t.Error("Record() returned nothing owed, want the recorded invalidation")
	}
}

// Two writes leaving the same tags stale are two debts, and the second must not
// be dropped as a duplicate of the first.
func TestRecordGivesEveryInvalidationItsOwnKey(t *testing.T) {
	setInternalURLs(t, "http://web-host:3000", "http://web-admin:3100", "http://web-platform:4100")
	queries := &recordingQuerier{}
	requester := NewRequester(RequesterConfig{Client: newTestClient(t), Queries: queries, Logger: quietLogger()})
	tenantID := uuid.Must(uuid.NewV7())

	for range 2 {
		if _, err := requester.Record(context.Background(), nil, tenantID, []string{"tenant:t:site"}); err != nil {
			t.Fatalf("Record() error = %v", err)
		}
	}

	recorded := queries.recorded()
	if len(recorded) != 2 {
		t.Fatalf("recorded %d events, want 2", len(recorded))
	}
	if recorded[0].IdempotencyKey == recorded[1].IdempotencyKey {
		t.Fatalf("both events carry %q, want a key each", recorded[0].IdempotencyKey)
	}
}

func TestRecordRefusesAnInvalidationWithNoTenant(t *testing.T) {
	setInternalURLs(t, "http://web-host:3000", "http://web-admin:3100", "http://web-platform:4100")
	queries := &recordingQuerier{}
	requester := NewRequester(RequesterConfig{Client: newTestClient(t), Queries: queries, Logger: quietLogger()})

	if _, err := requester.Record(context.Background(), nil, uuid.Nil, []string{"tenant:t:site"}); err == nil {
		t.Fatal("Record() error = nil, want the missing tenant reported")
	}
	if recorded := queries.recorded(); len(recorded) != 0 {
		t.Fatalf("recorded %v, want nothing written", recorded)
	}
}

func TestRecordWritesNothingWhenRevalidationIsTurnedOff(t *testing.T) {
	var requester *Requester

	owed, err := requester.Record(context.Background(), nil, uuid.Must(uuid.NewV7()), []string{"tenant:t:site"})
	if err != nil {
		t.Fatalf("Record() error = %v", err)
	}
	if owed.eventID != uuid.Nil {
		t.Fatalf("Record() = %v, want nothing owed", owed)
	}
}

// The immediate attempt is an optimization: once every app has answered, the
// row is done and the worker has nothing left to send.
func TestSendMarksTheInvalidationDoneOnceEveryAppAnswered(t *testing.T) {
	apps := newRecordingApps(t, func(http.ResponseWriter) {})
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	tenantID := uuid.Must(uuid.NewV7())
	eventID := uuid.Must(uuid.NewV7())
	mock.ExpectExec("app.current_tenant_id").WithArgs(tenantID.String()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.MarkPendingOutboxEventDone)).WithArgs(eventID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "event_type", "payload", "idempotency_key",
			"status", "attempts", "available_at", "last_error", "created_at", "updated_at",
		}).AddRow(
			eventID, uuid.NullUUID{UUID: tenantID, Valid: true}, outbox.EventTypeNextCacheRevalidation,
			json.RawMessage("{}"), "key", "done", int32(0), time.Now().UTC(), nil, time.Now().UTC(), time.Now().UTC(),
		))
	// The connection is reset before it goes back to the pool.
	mock.ExpectExec("app.current_user_id").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("app.current_tenant_id").WillReturnResult(sqlmock.NewResult(0, 1))

	requester := NewRequester(RequesterConfig{Client: newTestClient(t), DB: db, Logger: quietLogger()})
	requester.Send(context.Background(), Owed{eventID: eventID, tenantID: tenantID, tags: []string{"tenant:t:site"}})

	apps.waitForCalls(t, 3)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if err = mock.ExpectationsWereMet(); err == nil {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("unmet SQL expectations: %v", err)
}

// A console save must not wait on an app that never answers, and the row it
// recorded is what makes the drop happen anyway.
func TestSendReturnsWhileAnAppHangs(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-release
	}))
	t.Cleanup(server.Close)
	// Released before the server is closed: cleanups run in reverse, and Close
	// waits for the request this handler is still holding.
	t.Cleanup(func() { close(release) })
	setInternalURLs(t, server.URL, server.URL, server.URL)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectExec("app.current_tenant_id")

	requester := NewRequester(RequesterConfig{Client: newTestClient(t), DB: db, Logger: quietLogger()})
	started := time.Now()
	requester.Send(context.Background(), Owed{
		eventID:  uuid.Must(uuid.NewV7()),
		tenantID: uuid.Must(uuid.NewV7()),
		tags:     []string{"tenant:t:site"},
	})
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("Send() took %s, want it to return without waiting on the app", elapsed)
	}

	// Nothing was sent, so nothing is completed: the row stays pending and the
	// worker is what retries it. The connection the completion would take is
	// still expected.
	time.Sleep(100 * time.Millisecond)
	if mock.ExpectationsWereMet() == nil {
		t.Fatal("the invalidation was completed, want it left pending for the worker")
	}
}

// A requester with no database cannot complete what it sends, so it does not
// send: the drain the record is waiting on is the one that drops the tags.
func TestSendLeavesEverythingToTheWorkerWithoutADatabase(t *testing.T) {
	apps := newRecordingApps(t, func(http.ResponseWriter) {})

	requester := NewRequester(RequesterConfig{Client: newTestClient(t), Logger: quietLogger()})
	requester.Send(context.Background(), Owed{
		eventID:  uuid.Must(uuid.NewV7()),
		tenantID: uuid.Must(uuid.NewV7()),
		tags:     []string{"tenant:t:site"},
	})

	time.Sleep(100 * time.Millisecond)
	if calls := apps.calls(); calls != 0 {
		t.Fatalf("revalidate requests = %d, want none", calls)
	}
}
