package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/maintenancejobs"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/tickerjobs"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	serviceName = "publira-worker"

	defaultWorkerAddr        = ":8003"
	defaultWorkerDBURL       = "postgres://publira_outbox:outboxpass@db:5432/publira?sslmode=disable"
	defaultTickerDBURL       = "postgres://publira_ticker:tickerpass@db:5432/publira?sslmode=disable"
	defaultContentStatsDBURL = "postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable"
)

func main() {
	logger := logging.New(os.Stdout, nil)
	slog.SetDefault(logger)

	// One service.name per periodic job alongside the process default, so a run
	// of publish-episodes is still a publira-publish-episodes trace, and a
	// rebuild of the daily stats a publira-aggregate-content-stats one, now
	// that none of them has a process or a schedule of its own.
	serviceNames := append([]string{serviceName}, tickerjobs.ServiceNames()...)
	serviceNames = append(serviceNames, maintenancejobs.ServiceNames()...)
	shutdownTracing, err := tracing.Setup(context.Background(), serviceNames...)
	if err != nil {
		logger.Error("failed to initialize tracing", "error", err)
	}

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}
	if err := cfg.Push.ValidateWebPush(); err != nil {
		logger.Error("invalid Web Push configuration", "error", err)
		os.Exit(1)
	}

	db, err := sqldb.Open(resolveWorkerDBURL())
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		os.Exit(1)
	}
	defer db.Close() //nolint:errcheck

	// The periodic jobs get a pool of their own rather than sharing the one
	// above. publira_outbox owns River's schema and holds CREATE on the public
	// schema so rivermigrate can alter it; the three jobs promote episodes and
	// drop caches and create nothing, so they connect as the role that can do
	// only that.
	tickerDB, err := sqldb.Open(resolveTickerDBURL())
	if err != nil {
		logger.Error("failed to initialize the ticker jobs db", "error", err)
		os.Exit(1)
	}
	defer tickerDB.Close() //nolint:errcheck

	// One client for the whole process: the periodic jobs record what they owe
	// through it, and the handler below is what sends every recorded drop.
	revalidateClient := newRevalidateClient(logger)
	jobs, err := tickerjobs.New(tickerjobs.Config{
		DB: tickerDB,
		// No DB here on purpose: the ticker role may insert an outbox event and
		// not update one, and a drop recorded a drain away needs no attempt of
		// its own.
		Revalidate: revalidate.NewRequester(revalidate.RequesterConfig{
			Client:  revalidateClient,
			Queries: dbmodels.New(tickerDB),
			Logger:  logger,
		}),
		Logger:                     logger,
		PublishInterval:            envSeconds("PUBLIRA_PUBLISH_INTERVAL_SECONDS", 0),
		PublishMaxRetries:          envInt("PUBLIRA_PUBLISH_MAX_RETRIES", tickerjobs.DefaultPublishMaxRetries),
		FreeWindowInterval:         envSeconds("PUBLIRA_FREE_WINDOW_INTERVAL_SECONDS", 0),
		TenantDayInterval:          envSeconds("PUBLIRA_TENANT_DAY_INTERVAL_SECONDS", 0),
		PinnedAnnouncementInterval: envSeconds("PUBLIRA_PINNED_ANNOUNCEMENT_INTERVAL_SECONDS", 0),
	})
	if err != nil {
		logger.Error("failed to initialize the ticker jobs", "error", err)
		os.Exit(1)
	}
	logger.Info("ticker jobs registered", jobs.Settings()...)

	// The rebuild and purge work connects as publira_content_stats, the role
	// the batch subcommands have always used for it. It is the third login in
	// this process and the third pool: what the work may reach is decided by
	// the role, and a process that hosts three kinds of job is still not a
	// reason for any of them to borrow another's privileges.
	contentStatsDB, err := sqldb.Open(resolveContentStatsDBURL())
	if err != nil {
		logger.Error("failed to initialize the maintenance jobs db", "error", err)
		os.Exit(1)
	}
	defer contentStatsDB.Close() //nolint:errcheck

	reclaimer, err := resolveReclaimer(context.Background(), logger, cfg.Storage)
	if err != nil {
		logger.Error("failed to initialize object storage", "error", err)
		os.Exit(1)
	}
	maintenanceJobs, err := maintenancejobs.New(maintenancejobs.Config{
		DB:      contentStatsDB,
		Storage: reclaimer,
		Bucket:  cfg.Storage.S3Bucket,
		Logger:  logger,
	})
	if err != nil {
		logger.Error("failed to initialize the maintenance jobs", "error", err)
		os.Exit(1)
	}
	logger.Info("maintenance jobs registered", maintenanceJobs.Settings()...)

	// Declared as the interface, never as *secretcrypto.Manager: a typed nil
	// assigned to an interface is not nil, and it would slip past the guard in
	// emailsettings.DecryptPassword into a nil-receiver method call. A process
	// started without keys has to report an unusable manager, so a handler can
	// retry once an operator restarts it with them.
	var encryptor emailsettings.SecretManager
	if len(cfg.Encryption.Keys) > 0 {
		manager, managerErr := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if managerErr != nil {
			logger.Error("failed to initialize secret encryption manager", "error", managerErr)
			os.Exit(1)
		}
		encryptor = manager
	}

	// No Firebase credential means no push handler, so a local stack without
	// one still drains everything else. An event whose handler is missing goes
	// dead, which is the honest answer for a deployment that writes push events
	// it cannot send.
	pushHandlers := outbox.PushHandlerConfig{DB: db, Logger: logger}
	if cfg.Push.Configured() {
		sender, senderErr := push.New(context.Background(), push.Config{
			ProjectID:       cfg.Push.FCMProjectID,
			CredentialsJSON: cfg.Push.FCMCredentialsJSON,
		})
		if senderErr != nil {
			logger.Error("failed to initialize FCM client", "error", senderErr)
			os.Exit(1)
		}
		pushHandlers.Sender = sender
		logger.Info("mobile push is enabled", "fcm_project_id", sender.ProjectID())
	} else {
		logger.Info("mobile push is disabled", "reason", "no FCM credential is configured")
	}
	if cfg.Push.WebPushConfigured() {
		sender, senderErr := push.NewWebPushClient(push.WebPushConfig{
			VAPIDPublicKey:  cfg.Push.WebPushVAPIDPublicKey,
			VAPIDPrivateKey: cfg.Push.WebPushVAPIDPrivateKey,
			Subscriber:      cfg.Push.WebPushSubject,
		})
		if senderErr != nil {
			logger.Error("failed to initialize Web Push client", "error", senderErr)
			os.Exit(1)
		}
		pushHandlers.WebSender = sender
		logger.Info("web push is enabled")
	} else {
		logger.Info("web push is disabled", "reason", "no VAPID configuration is configured")
	}

	// Declared as the interface, never as *revalidate.Client: a typed nil
	// assigned to an interface is not nil, and the handler would then answer
	// every event by dropping nothing instead of reporting that this worker
	// cannot send.
	var invalidator outbox.CacheInvalidator
	if revalidateClient != nil {
		invalidator = revalidateClient
	}
	worker, err := outbox.Start(context.Background(), db, workerConfig(logger, []outbox.PeriodicRegistrar{jobs, maintenanceJobs}, outbox.EmailHandlerConfig{
		DB:        db,
		Encryptor: encryptor,
		Mailer:    internalsmtp.NewClient(),
		Renderer:  resolveEmailRenderer(logger),
	}, pushHandlers, outbox.StaffNotificationHandlerConfig{DB: db, Logger: logger},
		outbox.AnnouncementNotificationHandlerConfig{DB: db, Logger: logger}, invalidator))
	if err != nil {
		logger.Error("failed to start the outbox drain", "error", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()
	// One check per pool: with three logins behind one process, a single "db"
	// could not say which of them stopped answering.
	health.Register(mux,
		health.WithDBNamed("db.outbox", db),
		health.WithDBNamed("db.ticker", tickerDB),
		health.WithDBNamed("db.content_stats", contentStatsDB),
		health.WithReady(worker.Ready),
	)

	addr := strings.TrimSpace(os.Getenv("PUBLIRA_WORKER_ADDR"))
	if addr == "" {
		addr = defaultWorkerAddr
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting worker", "addr", addr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{
		httpserver.New(addr, mux),
	}, func(ctx context.Context) error {
		return worker.Stop(ctx)
	}, shutdownTracing, func(context.Context) error {
		return errors.Join(db.Close(), tickerDB.Close(), contentStatsDB.Close())
	}); err != nil {
		logger.Error("worker failed", "error", err)
		os.Exit(1)
	}
}

// PUBLIRA_DB_URL is deliberately not a fallback here. It is the connection the
// migration tooling uses — the superuser locally — so falling back to it would
// hand the worker more privilege than publira_outbox wherever the variable is
// left unset, which is exactly the mistake production must not make. Every
// other server resolves its own role variable the same way, so an unset
// variable lands on this role's development password and fails to authenticate
// instead.
func resolveWorkerDBURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_WORKER_DB_URL")); url != "" {
		return url
	}
	return defaultWorkerDBURL
}

// resolveTickerDBURL returns the connection the periodic jobs run on.
// PUBLIRA_DB_URL is no more a fallback here than it is for the worker's own
// URL above, and for the same reason.
func resolveTickerDBURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_TICKER_DB_URL")); url != "" {
		return url
	}
	return defaultTickerDBURL
}

// resolveContentStatsDBURL returns the connection the maintenance jobs run on.
// PUBLIRA_DB_URL is no more a fallback here than it is for the two URLs above,
// and for the same reason.
func resolveContentStatsDBURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_CONTENT_STATS_DB_URL")); url != "" {
		return url
	}
	return defaultContentStatsDBURL
}

// resolveReclaimer builds the bucket the orphan image sweep reclaims. A
// deployment with no bucket configured gets nil, which leaves that one job
// unregistered while every other maintenance job still runs — the alternative
// would be refusing to start a worker whose mail and ticker work needs no
// object storage at all.
func resolveReclaimer(ctx context.Context, logger *slog.Logger, cfg config.Storage) (storage.Reclaimer, error) {
	if err := cfg.Validate(); err != nil {
		logger.Info("orphan image reclamation is disabled", "reason", err.Error())
		return nil, nil
	}
	store, err := s3.New(ctx, s3.Config{
		Bucket:         cfg.S3Bucket,
		Region:         cfg.S3Region,
		Endpoint:       cfg.S3Endpoint,
		PublicBaseURL:  cfg.S3PublicBaseURL,
		ForcePathStyle: cfg.S3ForcePathStyle,
	})
	if err != nil {
		return nil, err
	}
	logger.Info("orphan image reclamation is enabled", "bucket", cfg.S3Bucket)
	return store, nil
}

// newRevalidateClient builds the client that sends Next.js cache tags. A
// deployment without a token gets a nil client, which makes every drop a no-op
// while each job still records the boundary it passed.
func newRevalidateClient(logger *slog.Logger) *revalidate.Client {
	client, err := revalidate.NewClient(strings.TrimSpace(os.Getenv("PUBLIRA_REVALIDATE_TOKEN")), logger)
	switch {
	case err != nil:
		logger.Warn("next revalidate is disabled", "reason", err.Error())
	case client == nil:
		logger.Info("next revalidate is disabled", "reason", "PUBLIRA_REVALIDATE_TOKEN is empty")
	}
	return client
}

func workerConfig(
	logger *slog.Logger,
	periodic []outbox.PeriodicRegistrar,
	emailHandlers outbox.EmailHandlerConfig,
	pushHandlers outbox.PushHandlerConfig,
	staffHandlers outbox.StaffNotificationHandlerConfig,
	announcementHandlers outbox.AnnouncementNotificationHandlerConfig,
	invalidator outbox.CacheInvalidator,
) outbox.Config {
	emailHandlers.Logger = logger
	handlers := outbox.DefaultRegistry()
	handlers.Register(outbox.EventTypeTenantAdminInvitationEmail, outbox.NewTenantAdminInvitationHandler(emailHandlers))
	handlers.Register(outbox.EventTypePlatformPasswordResetEmail, outbox.NewPlatformPasswordResetEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypePlatformEmailChangeConfirmationEmail, outbox.NewPlatformEmailChangeConfirmationEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypePlatformEmailChangedNoticeEmail, outbox.NewPlatformEmailChangedNoticeEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeReaderEmailVerificationEmail, outbox.NewReaderEmailVerificationEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeReaderEmailChangeConfirmationEmail, outbox.NewReaderEmailChangeConfirmationEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeReaderEmailChangedNoticeEmail, outbox.NewReaderEmailChangedNoticeEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeReaderPasswordResetEmail, outbox.NewReaderPasswordResetEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeReaderPasswordChangedNoticeEmail, outbox.NewReaderPasswordChangedNoticeEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeReaderSignupAttemptNoticeEmail, outbox.NewReaderSignupAttemptNoticeEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeAdminPasswordResetEmail, outbox.NewAdminPasswordResetEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeAdminEmailChangeConfirmationEmail, outbox.NewAdminEmailChangeConfirmationEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeAdminEmailChangedNoticeEmail, outbox.NewAdminEmailChangedNoticeEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeContactMessageStaffEmail, outbox.NewContactMessageStaffEmailHandler(emailHandlers))
	handlers.Register(outbox.EventTypeCommentAwaitingApprovalNotification, outbox.NewCommentAwaitingApprovalNotificationHandler(staffHandlers))
	handlers.Register(outbox.EventTypeCommentReportedNotification, outbox.NewCommentReportedNotificationHandler(staffHandlers))
	handlers.Register(outbox.EventTypeAnnouncementNotification, outbox.NewAnnouncementNotificationHandler(announcementHandlers))
	handlers.Register(outbox.EventTypeNextCacheRevalidation, outbox.NewNextCacheRevalidationHandler(invalidator))
	if pushHandlers.Sender != nil || pushHandlers.WebSender != nil {
		handlers.Register(outbox.EventTypeMemberPushNotification, outbox.NewMemberPushNotificationHandler(pushHandlers))
	}
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

func envDuration(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		return fallback
	}
	return d
}

func envInt(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return fallback
	}
	return n
}

// envSeconds reads a whole number of seconds, which is the unit the three
// interval variables have carried since they configured processes of their own.
func envSeconds(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return time.Duration(n) * time.Second
}

func envInt32(name string, fallback int32) int32 {
	n := envInt(name, int(fallback))
	return int32(n)
}
