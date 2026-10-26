package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strings"

	"github.com/riverqueue/river"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/fcmsettings"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/maintenancejobs"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/platformsearch"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/signin"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tickerjobs"
	"github.com/publira/publira/server/internal/webpushsettings"
)

const (
	defaultWorkerAddr        = ":8003"
	defaultWorkerDBURL       = "postgres://publira_outbox:outboxpass@db:5432/publira?sslmode=disable"
	defaultTickerDBURL       = "postgres://publira_ticker:tickerpass@db:5432/publira?sslmode=disable"
	defaultContentStatsDBURL = "postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable"

	// contentStatsDBReplicaURLEnv names a hot standby the maintenance jobs'
	// rebuilds read content_events on. Like the storefront's, it has no
	// development default: unset is no replica, and every read stays on
	// PUBLIRA_CONTENT_STATS_DB_URL.
	contentStatsDBReplicaURLEnv = "PUBLIRA_CONTENT_STATS_DB_REPLICA_URL"
)

// workerQueues is which River queues a worker process hosts. A queue is named
// for the work on it: outbox is River's default queue, which the Outbox drain
// has to itself, and ticker, maintenance, and search_index are the queues of
// those names the job families bring. A queue brings the pool its jobs connect
// as, and every queue brings publira_outbox, which the River client itself
// connects as.
type workerQueues struct {
	outbox      bool
	ticker      bool
	maintenance bool
	searchIndex bool
}

// allWorkerQueues is what a worker hosts unless --queue names some.
var allWorkerQueues = workerQueues{outbox: true, ticker: true, maintenance: true, searchIndex: true}

func (q workerQueues) any() bool { return q.outbox || q.ticker || q.maintenance || q.searchIndex }

// contentStats reports whether the process opens the publira_content_stats
// pool, which the maintenance jobs and the search index build both run on.
func (q workerQueues) contentStats() bool { return q.maintenance || q.searchIndex }

// workerQueueEntry is one queue as --queue names it and as River does.
type workerQueueEntry struct {
	name  string
	river string
	field func(*workerQueues) *bool
}

// workerQueueTable is every queue, in the order the logs name them.
var workerQueueTable = []workerQueueEntry{
	{"outbox", river.QueueDefault, func(q *workerQueues) *bool { return &q.outbox }},
	{"ticker", tickerjobs.QueueName, func(q *workerQueues) *bool { return &q.ticker }},
	{"maintenance", maintenancejobs.QueueName, func(q *workerQueues) *bool { return &q.maintenance }},
	{"search_index", maintenancejobs.SearchIndexQueueName, func(q *workerQueues) *bool { return &q.searchIndex }},
}

// names answers the --queue names of the queues hosted or, with hosted false,
// of the ones left to another replica.
func (q workerQueues) names(hosted bool) []string {
	var names []string
	for _, queue := range workerQueueTable {
		if *queue.field(&q) == hosted {
			names = append(names, queue.name)
		}
	}
	return names
}

// riverQueues answers the River names of the queues hosted.
func (q workerQueues) riverQueues() []string {
	var names []string
	for _, queue := range workerQueueTable {
		if *queue.field(&q) {
			names = append(names, queue.river)
		}
	}
	return names
}

// add takes one --queue value, a comma-separated list of queues. A list that
// names nothing, an unknown queue, or a queue already named is a mistake rather
// than a setting, so it is refused instead of narrowed to what it could mean.
func (q *workerQueues) add(value string) error {
	for name := range strings.SplitSeq(value, ",") {
		name = strings.TrimSpace(name)
		if name == "" {
			return errors.New("--queue names an empty queue; name outbox, ticker, maintenance, or search_index")
		}
		i := slices.IndexFunc(workerQueueTable, func(queue workerQueueEntry) bool { return queue.name == name })
		if i < 0 {
			return fmt.Errorf("--queue must be outbox, ticker, maintenance, or search_index, not %q", name)
		}
		hosted := workerQueueTable[i].field(q)
		if *hosted {
			return fmt.Errorf("--queue names %q twice", name)
		}
		*hosted = true
	}
	return nil
}

// workerServiceNames is one service.name per periodic job alongside the
// Outbox drain's, so a run of publish-episodes is still a
// publira-publish-episodes trace, and a rebuild of the daily stats a
// publira-aggregate-content-stats one, now that none of them has a process or
// a schedule of its own. The drain's comes first: it is the worker process's
// default.
func workerServiceNames() []string {
	serviceNames := append([]string{outbox.ServiceName}, tickerjobs.ServiceNames()...)
	return append(serviceNames, maintenancejobs.ServiceNames()...)
}

// buildWorker builds and starts the one River client a process needs: it
// drains the Outbox, runs the periodic jobs, and owns the maintenance jobs, so
// nothing beside it has to invoke a job on a timer. A queue the process does not
// host opens no pool and reads no variable of its own, but its jobs stay
// registered and on the schedule, since whichever replica River elects leader
// enqueues them all and rescues any a dead replica left running.
func buildWorker(deps shared, queues workerQueues) (_ half, err error) {
	logger := deps.logger

	// The Outbox drain cancels the subscriptions of deleted accounts, so it
	// calls the payment providers where the server does. Read before a pool is
	// opened, so a misconfiguration is refused without reaching the database.
	var payments *paymentprovider.Registry
	if queues.outbox {
		paymentsConfig, err := providers.ConfigFromEnv()
		if err != nil {
			return half{}, failed("failed to load config", err)
		}
		payments = providers.New(paymentsConfig)
	}

	pools, err := openWorkerPools(queues, sqldb.Open)
	if err != nil {
		return half{}, err
	}
	// Each pool is closed again when a later step fails, since the process
	// that hosts this half may already be holding the server's.
	defer func() {
		if err != nil {
			_ = pools.close()
		}
	}()
	db := pools.outbox
	encryptor := deps.encryptor

	var periodic []outbox.PeriodicRegistrar

	tickerConfig := tickerjobs.Config{
		Logger:                     logger,
		PublishInterval:            envSeconds("PUBLIRA_PUBLISH_INTERVAL_SECONDS", 0),
		FreeWindowInterval:         envSeconds("PUBLIRA_FREE_WINDOW_INTERVAL_SECONDS", 0),
		TenantDayInterval:          envSeconds("PUBLIRA_TENANT_DAY_INTERVAL_SECONDS", 0),
		PinnedAnnouncementInterval: envSeconds("PUBLIRA_PINNED_ANNOUNCEMENT_INTERVAL_SECONDS", 0),
		SeriesPublicationInterval:  envSeconds("PUBLIRA_SERIES_PUBLICATION_INTERVAL_SECONDS", 0),
		CampaignBannerInterval:     envSeconds("PUBLIRA_CAMPAIGN_BANNER_INTERVAL_SECONDS", 0),
		CampaignPriceInterval:      envSeconds("PUBLIRA_CAMPAIGN_PRICE_INTERVAL_SECONDS", 0),
		CoinExpiryInterval:         envSeconds("PUBLIRA_COIN_EXPIRY_INTERVAL_SECONDS", 0),
		FreeAfterInterval:          envSeconds("PUBLIRA_FREE_AFTER_INTERVAL_SECONDS", 0),
	}
	if tickerDB := pools.ticker; tickerDB != nil {
		tickerConfig.DB = tickerDB
		// No DB here on purpose: the ticker role may insert an outbox event and
		// not update one, and a drop recorded a drain away needs no attempt of
		// its own.
		tickerConfig.Revalidate = revalidate.NewRequester(revalidate.RequesterConfig{
			Client:  deps.revalidate,
			Queries: dbmodels.New(tickerDB),
			Logger:  logger,
		})
		tickerConfig.PublishMaxRetries = envInt("PUBLIRA_PUBLISH_MAX_RETRIES", tickerjobs.DefaultPublishMaxRetries)
		jobs, err := tickerjobs.New(tickerConfig)
		if err != nil {
			return half{}, failed("failed to initialize the ticker jobs", err)
		}
		logger.Info("ticker jobs registered", jobs.Settings()...)
		periodic = append(periodic, jobs)
	} else {
		periodic = append(periodic, tickerjobs.Unhosted(tickerConfig))
	}

	if contentStatsDB := pools.contentStats; contentStatsDB != nil {
		// The bucket the orphan image sweep reclaims is read from the
		// platform's settings when a run starts, so the worker starts before
		// one is saved.
		reclaimers := platformstorage.Reclaimers{Resolver: platformstorage.New(platformstorage.Config{
			Queries: dbmodels.New(contentStatsDB),
			Secrets: encryptor,
			Logger:  logger,
		}, platformstorage.NewStorage)}
		maintenanceJobs, err := maintenancejobs.New(maintenancejobs.Config{
			DB:         contentStatsDB,
			Replica:    pools.contentStatsReplica,
			Storage:    reclaimers,
			Secrets:    encryptor,
			GooglePlay: googleplay.NewClient(googleplay.Config{}),
			Logger:     logger,
		})
		if err != nil {
			return half{}, failed("failed to initialize the maintenance jobs", err)
		}
		logger.Info("maintenance jobs registered", maintenanceJobs.Settings()...)
		periodic = append(periodic, maintenanceJobs)
	} else {
		periodic = append(periodic, maintenancejobs.Unhosted())
	}

	// A job on a queue no replica hosts is enqueued all the same and waits in
	// river_job until one does, so the queues left to others are named here.
	if notHosted := queues.names(false); len(notHosted) > 0 {
		logger.Info("worker leaves queues to other replicas; each needs at least one replica that hosts it",
			"hosted", queues.names(true),
			"not_hosted", notHosted,
		)
	}

	// The worker writes the documents the catalog_index_sync events name into
	// the engines the platform's search settings name. The row is reread for
	// every event rather than on the resolvers' interval: a build reads the
	// catalog once and relies on every write that commits after that read
	// reaching the index it is building.
	catalogIndexer := platformsearch.Indexer{
		DB: db,
		Resolver: platformsearch.NewResolver(platformsearch.ResolverConfig{
			Queries:  dbmodels.New(db),
			Secrets:  encryptor,
			Interval: -1,
			Logger:   logger,
		}),
	}

	// Both senders read their credentials per delivery, so a tenant connecting
	// its Firebase project or an operator saving the Web Push subject takes
	// effect while this runs.
	pushHandlers := outbox.PushHandlerConfig{
		DB:        db,
		Logger:    logger,
		Sender:    fcmsettings.NewSenders(dbmodels.New(db), encryptor, fcmsettings.NewPushClient, fcmsettings.CacheTTL, logger),
		WebSender: webpushsettings.NewSenders(dbmodels.New(db), encryptor, webpushsettings.NewPushClient, webpushsettings.CacheTTL, logger),
	}

	// Declared as the interface, never as *revalidate.Client: a typed nil
	// assigned to an interface is not nil, and the handler would then answer
	// every event by dropping nothing instead of reporting that this worker
	// cannot send.
	var invalidator outbox.CacheInvalidator
	if deps.revalidate != nil {
		invalidator = deps.revalidate
	}
	// The catalog index handler owes the storefront's searches a drop once the
	// document it wrote can be found. It records the drop on this pool and
	// leaves the sending to the handler above, the way the ticker jobs do; the
	// same typed-nil guard applies, since NewRequester answers nil when
	// revalidation is off.
	var searchCacheRecorder outbox.CacheInvalidationRecorder
	if requester := revalidate.NewRequester(revalidate.RequesterConfig{
		Client:  deps.revalidate,
		Queries: dbmodels.New(db),
		Logger:  logger,
	}); requester != nil {
		searchCacheRecorder = requester
	}
	cfg := workerConfig(logger, periodic, outbox.EmailHandlerConfig{
		DB:        db,
		Encryptor: encryptor,
		Mailer:    internalsmtp.NewClient(),
		Renderer:  resolveEmailRenderer(logger),
	}, pushHandlers, outbox.StaffNotificationHandlerConfig{DB: db, Logger: logger},
		outbox.AnnouncementNotificationHandlerConfig{DB: db, Logger: logger},
		outbox.EpisodePublishedNotificationHandlerConfig{DB: db, Logger: logger},
		outbox.CommentApprovedNotificationHandlerConfig{DB: db},
		outbox.GooglePlayHandlerConfig{DB: db, Encryptor: encryptor, Purchases: googleplay.NewClient(googleplay.Config{})},
		outbox.AppleSignInHandlerConfig{DB: db, Encryptor: encryptor, Tokens: signin.NewAppleClient(signin.AppleClientConfig{})},
		outbox.SubscriptionCancelHandlerConfig{DB: db, Encryptor: encryptor, Providers: payments},
		invalidator, catalogIndexer, searchCacheRecorder)
	cfg.Queues = queues.riverQueues()
	worker, err := outbox.Start(context.Background(), db, cfg)
	if err != nil {
		return half{}, failed("failed to start the outbox drain", err)
	}

	mux := http.NewServeMux()
	health.Register(mux, append(pools.checks(), health.WithReady(worker.Ready))...)

	addr := addrFromEnv("PUBLIRA_WORKER_ADDR", defaultWorkerAddr)

	return half{
		listeners: []httpserver.Listener{{Name: "worker", Server: httpserver.New(addr, mux)}},
		stop:      []func(context.Context) error{worker.Stop},
		close:     pools.close,
	}, nil
}

// workerPools is one pool per PostgreSQL login the queues a worker hosts
// connect as, nil for a login none of them needs. Each job family connects as
// the role named for its work rather than on the outbox pool: publira_outbox
// owns River's schema and holds CREATE on the public schema so rivermigrate can
// alter it, which is the privilege the jobs must not have. publira_ticker
// promotes episodes and records cache drops and creates nothing, and
// publira_content_stats rebuilds and purges, the role the publiractl
// subcommands use for the same work.
type workerPools struct {
	outbox       *sql.DB
	ticker       *sql.DB
	contentStats *sql.DB
	// contentStatsReplica is a hot standby signed in as publira_content_stats,
	// which the maintenance queue's rebuilds read content_events on. It is nil
	// unless the process hosts that queue and PUBLIRA_CONTENT_STATS_DB_REPLICA_URL
	// names one: the search index build, the other job on that login, reads
	// nothing on it.
	contentStatsReplica *sql.DB
}

// openWorkerPools opens the pool of each login the queues need, closing the
// ones already open when a later one fails. publira_outbox is opened whatever
// the queues, because the River client itself connects as it. The variable of
// a login no queue needs is never read.
func openWorkerPools(queues workerQueues, open func(url string) (*sql.DB, error)) (workerPools, error) {
	var pools workerPools
	for _, login := range []struct {
		needed   bool
		env      string
		fallback string
		failure  string
		pool     **sql.DB
	}{
		{true, "PUBLIRA_WORKER_DB_URL", defaultWorkerDBURL, "failed to initialize db", &pools.outbox},
		{queues.ticker, "PUBLIRA_TICKER_DB_URL", defaultTickerDBURL, "failed to initialize the ticker jobs db", &pools.ticker},
		{queues.contentStats(), "PUBLIRA_CONTENT_STATS_DB_URL", defaultContentStatsDBURL, "failed to initialize the maintenance jobs db", &pools.contentStats},
	} {
		if !login.needed {
			continue
		}
		db, err := open(dbURLFromEnv(login.env, login.fallback))
		if err != nil {
			return workerPools{}, errors.Join(failed(login.failure, err), pools.close())
		}
		*login.pool = db
	}
	if queues.maintenance {
		replica, err := openReplicaPool(pools.contentStats, contentStatsDBReplicaURLEnv)
		if err != nil {
			return workerPools{}, errors.Join(failed("failed to initialize the maintenance jobs replica", err), pools.close())
		}
		pools.contentStatsReplica = replica
	}
	return pools, nil
}

// checks is one readiness check per pool open: with up to three logins behind
// one half, and a replica beside one of them, a single "db" could not say which
// of them stopped answering.
func (p workerPools) checks() []health.Option {
	var checks []health.Option
	for _, pool := range []struct {
		name string
		db   *sql.DB
	}{
		{"db.outbox", p.outbox},
		{"db.ticker", p.ticker},
		{"db.content_stats", p.contentStats},
		{"db.content_stats.replica", p.contentStatsReplica},
	} {
		if pool.db != nil {
			checks = append(checks, health.WithDBNamed(pool.name, pool.db))
		}
	}
	return checks
}

func (p workerPools) close() error {
	var errs []error
	for _, db := range []*sql.DB{p.outbox, p.ticker, p.contentStats, p.contentStatsReplica} {
		if db != nil {
			errs = append(errs, db.Close())
		}
	}
	return errors.Join(errs...)
}

func workerConfig(
	logger *slog.Logger,
	periodic []outbox.PeriodicRegistrar,
	emailHandlers outbox.EmailHandlerConfig,
	pushHandlers outbox.PushHandlerConfig,
	staffHandlers outbox.StaffNotificationHandlerConfig,
	announcementHandlers outbox.AnnouncementNotificationHandlerConfig,
	episodePublishedHandlers outbox.EpisodePublishedNotificationHandlerConfig,
	commentApprovedHandlers outbox.CommentApprovedNotificationHandlerConfig,
	googlePlayHandlers outbox.GooglePlayHandlerConfig,
	appleSignInHandlers outbox.AppleSignInHandlerConfig,
	subscriptionCancelHandlers outbox.SubscriptionCancelHandlerConfig,
	invalidator outbox.CacheInvalidator,
	catalogIndexer outbox.CatalogIndexer,
	searchCacheRecorder outbox.CacheInvalidationRecorder,
) outbox.Config {
	emailHandlers.Logger = logger
	handlers := outbox.DefaultRegistry()
	handlers.Register(outbox.EventTypeTenantAdminInvitationEmail, outbox.NewTenantAdminInvitationHandler(emailHandlers))
	handlers.Register(outbox.EventTypePlatformPasswordResetEmail, outbox.NewPlatformPasswordResetEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypePlatformPasswordResetRequest, outbox.NewPlatformPasswordResetRequestHandler(emailHandlers))
	handlers.Register(outbox.EventTypePlatformEmailChangeConfirmationEmail, outbox.NewPlatformEmailChangeConfirmationEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypePlatformEmailChangedNoticeEmail, outbox.NewPlatformEmailChangedNoticeEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypePlatformOperatorRoleGrantedEmail, outbox.NewPlatformOperatorRoleGrantedEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeReaderEmailVerificationEmail, outbox.NewReaderEmailVerificationEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeReaderEmailChangeConfirmationEmail, outbox.NewReaderEmailChangeConfirmationEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeReaderEmailChangedNoticeEmail, outbox.NewReaderEmailChangedNoticeEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeReaderPasswordResetEmail, outbox.NewReaderPasswordResetEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeReaderPasswordChangedNoticeEmail, outbox.NewReaderPasswordChangedNoticeEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeReaderSignupAttemptNoticeEmail, outbox.NewReaderSignupAttemptNoticeEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeReaderSignupRequest, outbox.NewReaderSignupRequestHandler(emailHandlers))
	handlers.Register(outbox.EventTypeReaderPasswordResetRequest, outbox.NewReaderPasswordResetRequestHandler(emailHandlers))
	handlers.Register(outbox.EventTypeReaderEmailVerificationRequest, outbox.NewReaderEmailVerificationRequestHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeAdminPasswordResetEmail, outbox.NewAdminPasswordResetEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeAdminPasswordResetRequest, outbox.NewAdminPasswordResetRequestHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeAdminEmailChangeConfirmationEmail, outbox.NewAdminEmailChangeConfirmationEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeAdminEmailChangedNoticeEmail, outbox.NewAdminEmailChangedNoticeEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeContactMessageStaffEmail, outbox.NewContactMessageStaffEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeContactMessageReplyEmail, outbox.NewContactMessageReplyEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypePurchaseReceipt, outbox.NewPurchaseReceiptEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeNotificationEmail, outbox.NewNotificationEmailHandler(emailHandlers))
	handlers.RegisterMessage(outbox.EventTypeCommentAwaitingApprovalNotification, outbox.NewCommentAwaitingApprovalNotificationHandler(staffHandlers))
	handlers.RegisterMessage(outbox.EventTypeCommentReportedNotification, outbox.NewCommentReportedNotificationHandler(staffHandlers))
	handlers.RegisterMessage(outbox.EventTypeAnnouncementNotification, outbox.NewAnnouncementNotificationHandler(announcementHandlers))
	handlers.RegisterMessage(outbox.EventTypeEpisodePublishedNotification, outbox.NewEpisodePublishedNotificationHandler(episodePublishedHandlers))
	handlers.RegisterMessage(outbox.EventTypeCommentApprovedNotification, outbox.NewCommentApprovedNotificationHandler(commentApprovedHandlers))
	handlers.Register(outbox.EventTypeNextCacheRevalidation, outbox.NewNextCacheRevalidationHandler(invalidator))
	handlers.Register(outbox.EventTypeCatalogIndexSync, outbox.NewCatalogIndexSyncHandler(catalogIndexer, searchCacheRecorder))
	handlers.RegisterMessage(outbox.EventTypeMemberPushNotification, outbox.NewMemberPushNotificationHandler(pushHandlers))
	googlePlayHandlers.Logger = logger
	handlers.Register(outbox.EventTypeGooglePlayPurchaseConsume, outbox.NewGooglePlayPurchaseConsumeHandler(googlePlayHandlers))
	appleSignInHandlers.Logger = logger
	handlers.Register(outbox.EventTypeAppleSignInCodeExchange, outbox.NewAppleSignInCodeExchangeHandler(appleSignInHandlers))
	handlers.Register(outbox.EventTypeAppleSignInTokenRevoke, outbox.NewAppleSignInTokenRevokeHandler(appleSignInHandlers))
	subscriptionCancelHandlers.Logger = logger
	handlers.Register(outbox.EventTypeSubscriptionCancel, outbox.NewSubscriptionCancelHandler(subscriptionCancelHandlers))
	return outbox.Config{
		Logger:            logger,
		Handlers:          handlers,
		Periodic:          periodic,
		DrainInterval:     envDuration("PUBLIRA_OUTBOX_DRAIN_INTERVAL", 0),
		ClaimLimit:        envInt32("PUBLIRA_OUTBOX_CLAIM_LIMIT", 0),
		MaxAttempts:       envInt("PUBLIRA_OUTBOX_MAX_ATTEMPTS", 0),
		StaleProcessing:   envDuration("PUBLIRA_OUTBOX_STALE_PROCESSING", 0),
		MaxWorkers:        envInt("PUBLIRA_OUTBOX_MAX_WORKERS", 0),
		FetchCooldown:     envDuration("PUBLIRA_OUTBOX_FETCH_COOLDOWN", 0),
		FetchPollInterval: envDuration("PUBLIRA_OUTBOX_FETCH_POLL_INTERVAL", 0),
	}
}

// resolveEmailRenderer answers nil for a deployment that runs no renderer, so
// its mail goes out as the text the worker composes itself. A default URL here
// would instead point every such deployment at a service that is not there, and
// retry each mail event until the row dead-letters.
func resolveEmailRenderer(logger *slog.Logger) emailrenderer.Renderer {
	url := strings.TrimSpace(os.Getenv("PUBLIRA_EMAIL_RENDERER_URL"))
	if url == "" {
		logger.Info("html email parts are disabled", "reason", "no email renderer URL is configured")
		return nil
	}
	logger.Info("html email parts are enabled", "email_renderer_url", url)
	return emailrenderer.NewClient(url)
}
