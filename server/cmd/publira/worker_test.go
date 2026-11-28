package main

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/maintenancejobs"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/tenantwebhooks"
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
		{"payment_reconciliation", workerQueues{paymentReconciliation: true}, []string{outboxURL, contentStatsURL}, []string{"db.outbox", "db.content_stats"}},
		{"data_export", workerQueues{dataExport: true}, []string{outboxURL, contentStatsURL}, []string{"db.outbox", "db.content_stats"}},
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
		{allWorkerQueues, []string{river.QueueDefault, tickerjobs.QueueName, maintenancejobs.QueueName, maintenancejobs.SearchIndexQueueName, maintenancejobs.PaymentReconciliationQueueName, maintenancejobs.DataExportQueueName, maintenancejobs.TenantErasureQueueName}, nil},
		{workerQueues{outbox: true}, []string{river.QueueDefault}, []string{"ticker", "maintenance", "search_index", "payment_reconciliation", "data_export", "tenant_erasure"}},
		{workerQueues{ticker: true, searchIndex: true}, []string{tickerjobs.QueueName, maintenancejobs.SearchIndexQueueName}, []string{"outbox", "maintenance", "payment_reconciliation", "data_export", "tenant_erasure"}},
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
		outbox.DataExportReadyNotificationHandlerConfig{},
		outbox.GooglePlayHandlerConfig{}, outbox.AppleSignInHandlerConfig{},
		outbox.SubscriptionCancelHandlerConfig{},
		nil, nil, nil, nil)

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
		outbox.EventTypeAdminMfaChangedNoticeEmail,
		outbox.EventTypeContactMessageStaffEmail,
		outbox.EventTypeContactMessageReplyEmail,
		outbox.EventTypePurchaseReceipt,
		outbox.EventTypePurchaseRefundNotice,
		outbox.EventTypeSubscriptionStarted,
		outbox.EventTypeSubscriptionRenewed,
		outbox.EventTypeSubscriptionPaymentFailed,
		outbox.EventTypeSubscriptionEnded,
		outbox.EventTypeCommentAwaitingApprovalNotification,
		outbox.EventTypeCommentReportedNotification,
		outbox.EventTypeAnnouncementNotification,
		outbox.EventTypeEpisodePublishedNotification,
		outbox.EventTypeCommentApprovedNotification,
		outbox.EventTypeDataExportReadyNotification,
		outbox.EventTypeDataExportReadyEmail,
		outbox.EventTypeMemberPushNotification,
		outbox.EventTypeAnnouncementPushNotification,
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
		outbox.EventTypePlatformMfaChangedNoticeEmail,
		outbox.EventTypeNextCacheRevalidation,
		outbox.EventTypeCatalogIndexSync,
		outbox.EventTypeEpisodeNotificationsRemoval,
		outbox.EventTypeGooglePlayPurchaseConsume,
		outbox.EventTypeGooglePlaySubscriptionAcknowledge,
		outbox.EventTypeAppleSignInCodeExchange,
		outbox.EventTypeAppleSignInTokenRevoke,
		outbox.EventTypeSubscriptionCancel,
		outbox.EventTypePaymentRefundFollow,
		outbox.EventTypePaymentCheckoutFollow,
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

// A worker started without a dependency an event needs — its database, the
// SMTP client, a store's or a provider's client — leaves every pending event
// waiting for an operator to start it with one, charging it no attempt, so
// none is dead by the time the worker comes back whole. The two kinds of work
// an install may switch off for good, the cache revalidation and the search
// index, are done instead: nothing on the other end would ever take them.
func TestWorkerWithoutItsDependenciesBlocksEveryEvent(t *testing.T) {
	cfg := workerConfig(slog.Default(), nil,
		outbox.EmailHandlerConfig{}, outbox.PushHandlerConfig{}, outbox.StaffNotificationHandlerConfig{},
		outbox.AnnouncementNotificationHandlerConfig{}, outbox.EpisodePublishedNotificationHandlerConfig{},
		outbox.CommentApprovedNotificationHandlerConfig{},
		outbox.DataExportReadyNotificationHandlerConfig{},
		outbox.GooglePlayHandlerConfig{}, outbox.AppleSignInHandlerConfig{},
		outbox.SubscriptionCancelHandlerConfig{},
		nil, nil, nil, nil)

	switchedOff := []string{outbox.EventTypeNextCacheRevalidation, outbox.EventTypeCatalogIndexSync}
	for _, eventType := range cfg.Handlers.EventTypes() {
		if eventType == outbox.EventTypeTest {
			continue
		}
		t.Run(eventType, func(t *testing.T) {
			handle, _ := cfg.Handlers.Lookup(eventType)
			err := handle(t.Context(), dbmodels.OutboxEvent{
				ID:        uuid.Must(uuid.NewV7()),
				EventType: eventType,
				TenantID:  uuid.NullUUID{UUID: uuid.Must(uuid.NewV7()), Valid: true},
				Payload:   json.RawMessage(`{}`),
			})
			switch {
			case slices.Contains(switchedOff, eventType):
				if err != nil {
					t.Fatalf("handler error = %v, want the event done", err)
				}
			case !outbox.IsBlocked(err):
				t.Fatalf("handler error = %v, want it blocked", err)
			}
		})
	}
}

// An event type owed by a deadline, or sent to a server someone else runs,
// keeps a budget of its own in place of PUBLIRA_OUTBOX_MAX_ATTEMPTS, and every
// other type takes the configured one. Which types have one is a decision about
// how long each outage is waited out, so it is pinned here.
func TestWorkerRetryBudgets(t *testing.T) {
	cfg := workerConfig(slog.Default(), nil,
		outbox.EmailHandlerConfig{}, outbox.PushHandlerConfig{}, outbox.StaffNotificationHandlerConfig{},
		outbox.AnnouncementNotificationHandlerConfig{}, outbox.EpisodePublishedNotificationHandlerConfig{},
		outbox.CommentApprovedNotificationHandlerConfig{},
		outbox.DataExportReadyNotificationHandlerConfig{},
		outbox.GooglePlayHandlerConfig{}, outbox.AppleSignInHandlerConfig{},
		outbox.SubscriptionCancelHandlerConfig{},
		nil, nil, nil, nil)

	const configured = 7
	budgets := map[string]int{
		outbox.EventTypeGooglePlayPurchaseConsume:         outbox.GooglePlayMaxAttempts,
		outbox.EventTypeGooglePlaySubscriptionAcknowledge: outbox.GooglePlayMaxAttempts,
		outbox.EventTypeAppleSignInTokenRevoke:            outbox.AppleSignInTokenRevokeMaxAttempts,
		outbox.EventTypeWebhookDelivery:                   tenantwebhooks.MaxAttempts,
		outbox.EventTypeAppleSignInCodeExchange:           configured,
		outbox.EventTypeReaderPasswordResetEmail:          configured,
		outbox.EventTypePurchaseReceipt:                   configured,
		outbox.EventTypeNextCacheRevalidation:             configured,
	}
	for eventType, want := range budgets {
		if got := cfg.Handlers.MaxAttempts(eventType, configured); got != want {
			t.Errorf("%s has a budget of %d attempts, want %d", eventType, got, want)
		}
	}
}
