package main

import (
	"database/sql"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/riverqueue/river"

	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/maintenancejobs"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/tickerjobs"
)

// A worker opens the pool of each login its queues connect as and no other,
// and readiness names those pools alone. publira_outbox is opened whatever the
// queues, because the River client itself connects as it; the maintenance
// queue and the search index one share publira_content_stats. A login no queue
// needs is not even looked up, so its variable is never read.
func TestWorkerOpensThePoolsOfItsQueues(t *testing.T) {
	const (
		outboxURL       = "postgres://publira_outbox@db/publira"
		tickerURL       = "postgres://publira_ticker@db/publira"
		contentStatsURL = "postgres://publira_content_stats@db/publira"
	)
	for _, tc := range []struct {
		name   string
		queues workerQueues
		opened []string
		checks []string
	}{
		{"all", allWorkerQueues, []string{outboxURL, tickerURL, contentStatsURL}, []string{"db.outbox", "db.ticker", "db.content_stats"}},
		{"outbox", workerQueues{outbox: true}, []string{outboxURL}, []string{"db.outbox"}},
		{"ticker", workerQueues{ticker: true}, []string{outboxURL, tickerURL}, []string{"db.outbox", "db.ticker"}},
		{"maintenance", workerQueues{maintenance: true}, []string{outboxURL, contentStatsURL}, []string{"db.outbox", "db.content_stats"}},
		{"search_index", workerQueues{searchIndex: true}, []string{outboxURL, contentStatsURL}, []string{"db.outbox", "db.content_stats"}},
		{"ticker,maintenance,search_index", workerQueues{ticker: true, maintenance: true, searchIndex: true}, []string{outboxURL, tickerURL, contentStatsURL}, []string{"db.outbox", "db.ticker", "db.content_stats"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("PUBLIRA_WORKER_DB_URL", outboxURL)
			t.Setenv("PUBLIRA_TICKER_DB_URL", tickerURL)
			t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", contentStatsURL)
			t.Setenv(contentStatsDBReplicaURLEnv, "")

			var opened []string
			pools, err := openWorkerPools(tc.queues, func(url string) (*sql.DB, error) {
				opened = append(opened, url)
				return newPingOnlyPool(t), nil
			})
			if err != nil {
				t.Fatalf("openWorkerPools: %v", err)
			}
			if !slices.Equal(opened, tc.opened) {
				t.Fatalf("opened %v, want %v", opened, tc.opened)
			}

			mux := http.NewServeMux()
			health.Register(mux, pools.checks()...)
			ts := httptest.NewServer(mux)
			t.Cleanup(ts.Close)
			assertReadyChecks(t, ts.URL+"/readyz", tc.checks...)
		})
	}
}

// River's names for the queues are not the flag's: the Outbox drain's queue is
// River's default one.
func TestWorkerQueuesNameRiversQueues(t *testing.T) {
	for _, tc := range []struct {
		queues    workerQueues
		river     []string
		notHosted []string
	}{
		{allWorkerQueues, []string{river.QueueDefault, tickerjobs.QueueName, maintenancejobs.QueueName, maintenancejobs.SearchIndexQueueName}, nil},
		{workerQueues{outbox: true}, []string{river.QueueDefault}, []string{"ticker", "maintenance", "search_index"}},
		{workerQueues{ticker: true, searchIndex: true}, []string{tickerjobs.QueueName, maintenancejobs.SearchIndexQueueName}, []string{"outbox", "maintenance"}},
	} {
		if got := tc.queues.riverQueues(); !slices.Equal(got, tc.river) {
			t.Errorf("riverQueues(%+v) = %v, want %v", tc.queues, got, tc.river)
		}
		if got := tc.queues.names(false); !slices.Equal(got, tc.notHosted) {
			t.Errorf("names(%+v, false) = %v, want %v", tc.queues, got, tc.notHosted)
		}
	}
}

// The worker drops an event registered as a message while its tenant is
// suspended, and runs every other one. Moving a type between the two lists is
// a decision about what a suspended tenant's readers and staff receive, so it
// is pinned here rather than left to the order of the registrations.
func TestWorkerDropsOnlyMessagesForASuspendedTenant(t *testing.T) {
	cfg := workerConfig(slog.Default(), nil,
		outbox.EmailHandlerConfig{}, outbox.PushHandlerConfig{}, outbox.StaffNotificationHandlerConfig{},
		outbox.AnnouncementNotificationHandlerConfig{}, outbox.EpisodePublishedNotificationHandlerConfig{},
		outbox.CommentApprovedNotificationHandlerConfig{},
		outbox.GooglePlayHandlerConfig{}, outbox.AppleSignInHandlerConfig{},
		outbox.SubscriptionCancelHandlerConfig{},
		nil, nil, nil)

	messages := []string{
		outbox.EventTypeReaderEmailVerificationEmail,
		outbox.EventTypeReaderEmailChangeConfirmationEmail,
		outbox.EventTypeReaderEmailChangedNoticeEmail,
		outbox.EventTypeReaderPasswordResetEmail,
		outbox.EventTypeReaderPasswordChangedNoticeEmail,
		outbox.EventTypeReaderSignupAttemptNoticeEmail,
		outbox.EventTypeAdminPasswordResetEmail,
		outbox.EventTypeAdminEmailChangeConfirmationEmail,
		outbox.EventTypeAdminEmailChangedNoticeEmail,
		outbox.EventTypeContactMessageStaffEmail,
		outbox.EventTypeContactMessageReplyEmail,
		outbox.EventTypePurchaseReceipt,
		outbox.EventTypeCommentAwaitingApprovalNotification,
		outbox.EventTypeCommentReportedNotification,
		outbox.EventTypeAnnouncementNotification,
		outbox.EventTypeEpisodePublishedNotification,
		outbox.EventTypeCommentApprovedNotification,
		outbox.EventTypeMemberPushNotification,
	}
	others := []string{
		outbox.EventTypeTenantAdminInvitationEmail,
		outbox.EventTypeReaderSignupRequest,
		outbox.EventTypeReaderPasswordResetRequest,
		outbox.EventTypeReaderEmailVerificationRequest,
		outbox.EventTypeAdminPasswordResetRequest,
		outbox.EventTypePlatformPasswordResetEmail,
		outbox.EventTypePlatformPasswordResetRequest,
		outbox.EventTypePlatformEmailChangeConfirmationEmail,
		outbox.EventTypePlatformEmailChangedNoticeEmail,
		outbox.EventTypePlatformOperatorRoleGrantedEmail,
		outbox.EventTypeNextCacheRevalidation,
		outbox.EventTypeCatalogIndexSync,
		outbox.EventTypeGooglePlayPurchaseConsume,
		outbox.EventTypeGooglePlaySubscriptionAcknowledge,
		outbox.EventTypeAppleSignInCodeExchange,
		outbox.EventTypeAppleSignInTokenRevoke,
		outbox.EventTypeSubscriptionCancel,
	}

	for _, eventType := range slices.Concat(messages, others) {
		if _, ok := cfg.Handlers.Lookup(eventType); !ok {
			t.Errorf("%s has no handler", eventType)
		}
	}
	for _, eventType := range messages {
		if !cfg.Handlers.IsMessage(eventType) {
			t.Errorf("%s runs for a suspended tenant, want it dropped", eventType)
		}
	}
	for _, eventType := range others {
		if cfg.Handlers.IsMessage(eventType) {
			t.Errorf("%s is dropped for a suspended tenant, want it run", eventType)
		}
	}
}
