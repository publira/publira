package auditlog

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
)

type recorderTestQuerier struct {
	insertPlatform func(context.Context, dbmodels.InsertPlatformAuditLogParams) error
	insertTenant   func(context.Context, dbmodels.InsertAuditLogParams) error
}

func (q recorderTestQuerier) InsertPlatformAuditLog(ctx context.Context, params dbmodels.InsertPlatformAuditLogParams) error {
	if q.insertPlatform == nil {
		return nil
	}
	return q.insertPlatform(ctx, params)
}

func (q recorderTestQuerier) InsertAuditLog(ctx context.Context, params dbmodels.InsertAuditLogParams) error {
	if q.insertTenant == nil {
		return nil
	}
	return q.insertTenant(ctx, params)
}

func testAsyncConfig() AsyncConfig {
	return AsyncConfig{
		QueueSize:    1,
		WriteTimeout: time.Second,
		MaxAttempts:  3,
		RetryDelay:   time.Millisecond,
	}
}

func TestAsyncRecorderPersistsPlatformEntry(t *testing.T) {
	persisted := make(chan dbmodels.InsertPlatformAuditLogParams, 1)
	recorder := NewAsyncWithConfig(recorderTestQuerier{
		insertPlatform: func(_ context.Context, params dbmodels.InsertPlatformAuditLogParams) error {
			persisted <- params
			return nil
		},
	}, nil, slog.New(slog.DiscardHandler), testAsyncConfig())
	t.Cleanup(recorder.Close)

	recorder.RecordPlatform(context.Background(), PlatformEntry{
		ActorPlatformUserID: uuid.New(),
		ActorRole:           "platform_operator",
		Action:              "platform.tenant.create",
		Outcome:             OutcomeSuccess,
	})

	select {
	case entry := <-persisted:
		if entry.Action != "platform.tenant.create" {
			t.Fatalf("action = %q", entry.Action)
		}
		if entry.ID == uuid.Nil {
			t.Fatal("entry ID is empty")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for queued platform entry")
	}
}

func TestAsyncRecorderWritesWithRequestValuesButWithoutCancellation(t *testing.T) {
	type contextKey struct{}
	entered := make(chan struct{})
	release := make(chan struct{})
	result := make(chan struct {
		err   error
		value string
	}, 1)

	recorder := NewAsyncWithConfig(recorderTestQuerier{
		insertTenant: func(ctx context.Context, _ dbmodels.InsertAuditLogParams) error {
			close(entered)
			<-release
			value, _ := ctx.Value(contextKey{}).(string)
			result <- struct {
				err   error
				value string
			}{err: ctx.Err(), value: value}
			return nil
		},
	}, nil, slog.New(slog.DiscardHandler), testAsyncConfig())
	t.Cleanup(recorder.Close)

	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), contextKey{}, "request-value"))
	recorder.RecordTenant(ctx, TenantEntry{
		TenantID:    uuid.New(),
		ActorUserID: uuid.New(),
		ActorRole:   "tenant_admin",
		Action:      "admin.series.create",
		Outcome:     OutcomeSuccess,
	})
	<-entered
	cancel()
	close(release)

	select {
	case got := <-result:
		if got.err != nil {
			t.Fatalf("write context error = %v, want nil", got.err)
		}
		if got.value != "request-value" {
			t.Fatalf("write context value = %q", got.value)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for queued tenant entry")
	}
}

func TestAsyncRecorderRetriesFailedWrites(t *testing.T) {
	var calls atomic.Int32
	persisted := make(chan struct{}, 1)
	recorder := NewAsyncWithConfig(recorderTestQuerier{
		insertPlatform: func(_ context.Context, _ dbmodels.InsertPlatformAuditLogParams) error {
			if calls.Add(1) < 3 {
				return errors.New("temporary database failure")
			}
			persisted <- struct{}{}
			return nil
		},
	}, nil, slog.New(slog.DiscardHandler), testAsyncConfig())
	t.Cleanup(recorder.Close)

	recorder.RecordPlatform(context.Background(), PlatformEntry{Action: "platform.tenant.update", Outcome: OutcomeSuccess})

	select {
	case <-persisted:
		if got := calls.Load(); got != 3 {
			t.Fatalf("write attempts = %d, want 3", got)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for retried write")
	}
}

func TestAsyncRecorderDropsEntryWhenQueueIsFull(t *testing.T) {
	var logs bytes.Buffer
	started := make(chan struct{})
	release := make(chan struct{})
	var writes atomic.Int32
	recorder := NewAsyncWithConfig(recorderTestQuerier{
		insertPlatform: func(_ context.Context, _ dbmodels.InsertPlatformAuditLogParams) error {
			if writes.Add(1) == 1 {
				close(started)
				<-release
			}
			return nil
		},
	}, nil, slog.New(slog.NewTextHandler(&logs, nil)), testAsyncConfig())

	recorder.RecordPlatform(context.Background(), PlatformEntry{Action: "first", Outcome: OutcomeSuccess})
	<-started
	recorder.RecordPlatform(context.Background(), PlatformEntry{Action: "second", Outcome: OutcomeSuccess})
	recorder.RecordPlatform(context.Background(), PlatformEntry{Action: "dropped", Outcome: OutcomeSuccess})
	close(release)
	recorder.Close()

	if got := writes.Load(); got != 2 {
		t.Fatalf("persisted entries = %d, want 2", got)
	}
	if !strings.Contains(logs.String(), "auditlog: queue is full; dropping entry") {
		t.Fatalf("queue overflow was not logged: %s", logs.String())
	}
}

func TestAsyncRecorderDropsEntryAfterRetryBudget(t *testing.T) {
	var logs bytes.Buffer
	var calls atomic.Int32
	recorder := NewAsyncWithConfig(recorderTestQuerier{
		insertPlatform: func(_ context.Context, _ dbmodels.InsertPlatformAuditLogParams) error {
			calls.Add(1)
			return errors.New("database unavailable")
		},
	}, nil, slog.New(slog.NewTextHandler(&logs, nil)), testAsyncConfig())

	recorder.RecordPlatform(context.Background(), PlatformEntry{Action: "platform.tenant.delete", Outcome: OutcomeSuccess})
	recorder.Close()

	if got := calls.Load(); got != 3 {
		t.Fatalf("write attempts = %d, want 3", got)
	}
	if !strings.Contains(logs.String(), "auditlog: failed to persist; dropping entry") {
		t.Fatalf("failed write was not logged: %s", logs.String())
	}
}
