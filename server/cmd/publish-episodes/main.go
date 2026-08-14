package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/revalidate"
)

const (
	defaultIntervalSeconds = 60
	defaultMaxRetries      = 3
	defaultRetryBaseDelay  = 2 * time.Second
	defaultWorkerDBURL     = "postgres://postgres:password@db:5432/publira?sslmode=disable"

	notificationTypeEpisodePublishFailed = "episode_publish_failed"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	dbURL := cfg.DB.URL
	if dbURL == "" {
		dbURL = defaultWorkerDBURL
	}

	db, err := openDB(dbURL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close() //nolint:errcheck

	interval := resolveInterval()
	maxRetries := resolveMaxRetries()

	revalidateToken := strings.TrimSpace(os.Getenv("NEXT_REVALIDATE_TOKEN"))
	reval := revalidate.NewClient(revalidateToken, logger)
	if reval == nil {
		logger.Info("next revalidate is disabled", "reason", "NEXT_REVALIDATE_TOKEN is empty")
	}

	queries := dbmodels.New(db)
	runner := &runner{
		db:         db,
		queries:    queries,
		reval:      reval,
		logger:     logger,
		maxRetries: maxRetries,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("publish-episodes worker started", "interval", interval, "max_retries", maxRetries)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately on startup, then on each tick.
	runner.runOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			logger.Info("shutting down publish-episodes worker")
			return
		case <-ticker.C:
			runner.runOnce(ctx)
		}
	}
}

type runner struct {
	db         *sql.DB
	queries    *dbmodels.Queries
	reval      *revalidate.Client
	logger     *slog.Logger
	maxRetries int
	// publish, when set, replaces publishEpisode so tests can force a final failure.
	publish func(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error
}

type episodePublishFailedPayload struct {
	EpisodeID    string `json:"episode_id"`
	EpisodeTitle string `json:"episode_title"`
	SeriesID     string `json:"series_id"`
	SeriesTitle  string `json:"series_title"`
	TenantID     string `json:"tenant_id"`
	TenantName   string `json:"tenant_name"`
}

func (r *runner) runOnce(ctx context.Context) {
	rows, err := r.queries.ListEpisodesReadyToPublishWithTenantInfo(ctx)
	if err != nil {
		r.logger.Error("failed to list episodes ready to publish", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	r.logger.Info("found episodes ready to publish", "count", len(rows))

	for _, row := range rows {
		if ctx.Err() != nil {
			return
		}
		r.publishEpisodeWithRetry(ctx, row)
	}
}

func (r *runner) publishEpisodeWithRetry(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) {
	var lastErr error
	for attempt := 0; attempt <= r.maxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(math.Pow(2, float64(attempt-1))) * defaultRetryBaseDelay
			r.logger.Info("retrying publish",
				"episode_id", row.EpisodeID,
				"attempt", attempt,
				"delay", delay,
			)
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
		}

		if err := r.publishOne(ctx, row); err != nil {
			lastErr = err
			r.logger.Warn("failed to publish episode",
				"episode_id", row.EpisodeID,
				"tenant_id", row.TenantID.String(),
				"attempt", attempt+1,
				"error", err,
			)
			continue
		}

		r.logger.Info("episode published successfully",
			"episode_id", row.EpisodeID,
			"tenant_id", row.TenantID.String(),
		)
		return
	}

	r.logger.Error("episode publish failed after all retries",
		"episode_id", row.EpisodeID,
		"tenant_id", row.TenantID.String(),
		"max_retries", r.maxRetries,
		"error", lastErr,
	)
	r.notifyOperatorsOfPublishFailure(ctx, row)
}

func (r *runner) publishOne(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
	if r.publish != nil {
		return r.publish(ctx, row)
	}
	return r.publishEpisode(ctx, row.EpisodeID, row.TenantID.String(), row.TenantDomain)
}

func (r *runner) notifyOperatorsOfPublishFailure(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) {
	operators, err := r.queries.ListPlatformOperatorIDs(ctx)
	if err != nil {
		r.logger.Error("failed to list operators for publish-failed notification",
			"episode_id", row.EpisodeID,
			"tenant_id", row.TenantID.String(),
			"error", err,
		)
		return
	}

	payload, err := json.Marshal(episodePublishFailedPayload{
		EpisodeID:    row.EpisodePublicID,
		EpisodeTitle: row.EpisodeTitle,
		SeriesID:     row.SeriesPublicID,
		SeriesTitle:  row.SeriesTitle,
		TenantID:     row.TenantPublicID,
		TenantName:   row.TenantName,
	})
	if err != nil {
		r.logger.Error("failed to encode publish-failed notification payload",
			"episode_id", row.EpisodeID,
			"tenant_id", row.TenantID.String(),
			"error", err,
		)
		return
	}

	subjectKey := "episode:" + row.EpisodePublicID
	for _, operatorID := range operators {
		notificationID, err := uuid.NewV7()
		if err != nil {
			r.logger.Error("failed to allocate publish-failed notification id",
				"episode_id", row.EpisodeID,
				"platform_user_id", operatorID,
				"error", err,
			)
			continue
		}
		_, err = r.queries.CreatePlatformNotification(ctx, dbmodels.CreatePlatformNotificationParams{
			ID:               notificationID,
			PlatformUserID:   operatorID,
			NotificationType: notificationTypeEpisodePublishFailed,
			SubjectKey:       subjectKey,
			Payload:          payload,
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			r.logger.Error("failed to insert publish-failed notification",
				"episode_id", row.EpisodeID,
				"platform_user_id", operatorID,
				"error", err,
			)
		}
	}
}

func (r *runner) publishEpisode(ctx context.Context, episodeID uuid.UUID, tenantID, tenantDomain string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}

	qtx := r.queries.WithTx(tx)
	if err := qtx.MarkEpisodePublished(ctx, episodeID); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("mark episode published: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	if r.reval != nil {
		tags := []string{
			fmt.Sprintf("tenant:%s:series:detail", tenantID),
		}
		if err := r.reval.RevalidateTags(ctx, tenantID, tenantDomain, tags); err != nil {
			r.logger.Warn("failed to revalidate after episode publish",
				"episode_id", episodeID,
				"tenant_id", tenantID,
				"error", err,
			)
		}
	}

	return nil
}

func openDB(url string) (*sql.DB, error) {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func resolveInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("PUBLISH_INTERVAL_SECONDS"))
	if raw == "" {
		return defaultIntervalSeconds * time.Second
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultIntervalSeconds * time.Second
	}
	return time.Duration(n) * time.Second
}

func resolveMaxRetries() int {
	raw := strings.TrimSpace(os.Getenv("PUBLISH_MAX_RETRIES"))
	if raw == "" {
		return defaultMaxRetries
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return defaultMaxRetries
	}
	return n
}
