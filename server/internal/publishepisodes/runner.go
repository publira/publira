// Package publishepisodes publishes scheduled episodes and writes member
// notifications on success, tenant-admin notifications for the result,
// and operator notifications when the final attempt fails.
package publishepisodes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/cenkalti/backoff/v5"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/revalidate"
)

const (
	defaultRetryBaseDelay  = 2 * time.Second
	defaultRetryMultiplier = 2
	// The delay keeps doubling for the whole PUBLIRA_PUBLISH_MAX_RETRIES budget.
	defaultRetryMaxInterval = time.Duration(math.MaxInt64)

	notificationTypeEpisodePublished     = "episode_published"
	notificationTypeEpisodePublishFailed = "episode_publish_failed"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/publishepisodes")

// Runner lists due scheduled episodes and publishes them with retries.
type Runner struct {
	db         *sql.DB
	queries    *dbmodels.Queries
	reval      *revalidate.Client
	logger     *slog.Logger
	maxRetries int
	// publish, when set, replaces publishEpisode so tests can force a final failure.
	publish func(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error
	// notify, when set, replaces notifyMembersOfPublish so tests can force a
	// failure after the listing is marked published and before commit.
	notify func(ctx context.Context, q *dbmodels.Queries, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error
}

type episodePublishedPayload struct {
	EpisodeID    string `json:"episode_id"`
	EpisodeTitle string `json:"episode_title"`
	SeriesID     string `json:"series_id"`
	SeriesTitle  string `json:"series_title"`
}

type episodePublishFailedPayload struct {
	EpisodeID    string `json:"episode_id"`
	EpisodeTitle string `json:"episode_title"`
	SeriesID     string `json:"series_id"`
	SeriesTitle  string `json:"series_title"`
	TenantID     string `json:"tenant_id"`
	TenantName   string `json:"tenant_name"`
}

// New constructs a worker that publishes due episodes against db.
func New(db *sql.DB, queries *dbmodels.Queries, reval *revalidate.Client, logger *slog.Logger, maxRetries int) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	if queries == nil {
		queries = dbmodels.New(db)
	}
	return &Runner{
		db:         db,
		queries:    queries,
		reval:      reval,
		logger:     logger,
		maxRetries: maxRetries,
	}
}

// RunOnce publishes every episode that is due now.
//
// The cycle runs under one span so the queries it issues hang off a
// single trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "publishepisodes.RunOnce")
	defer span.End()

	rows, err := r.queries.ListEpisodesReadyToPublishWithTenantInfo(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list episodes ready to publish", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	span.SetAttributes(attribute.Int("publira.episodes.due", len(rows)))
	r.logger.InfoContext(ctx, "found episodes ready to publish", "count", len(rows))

	for _, row := range rows {
		if ctx.Err() != nil {
			return
		}
		r.publishEpisodeWithRetry(ctx, row)
	}
}

func (r *Runner) publishEpisodeWithRetry(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) {
	attempt := 0
	_, err := backoff.Retry(
		ctx,
		func() (struct{}, error) {
			attempt++
			return struct{}{}, r.publishOne(ctx, row)
		},
		backoff.WithBackOff(newPublishBackOff()),
		backoff.WithMaxTries(uint(r.maxRetries)+1),
		// Drops the library's 15-minute cap so the attempt budget and ctx are the limits.
		backoff.WithMaxElapsedTime(0),
		backoff.WithNotify(func(err error, delay time.Duration) {
			r.logger.WarnContext(ctx, "failed to publish episode",
				"episode_id", row.EpisodeID,
				"tenant_id", row.TenantID.String(),
				"attempt", attempt,
				"error", err,
			)
			r.logger.InfoContext(ctx, "retrying publish",
				"episode_id", row.EpisodeID,
				"attempt", attempt,
				"delay", delay,
			)
		}),
	)
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		r.logger.ErrorContext(ctx, "episode publish failed after all retries",
			"episode_id", row.EpisodeID,
			"tenant_id", row.TenantID.String(),
			"max_retries", r.maxRetries,
			"error", err,
		)
		r.notifyTenantAdmins(ctx, row, notificationTypeEpisodePublishFailed)
		r.notifyOperatorsOfPublishFailure(ctx, row)
		return
	}

	r.logger.InfoContext(ctx, "episode published successfully",
		"episode_id", row.EpisodeID,
		"tenant_id", row.TenantID.String(),
	)
	r.notifyTenantAdmins(ctx, row, notificationTypeEpisodePublished)
}

// newPublishBackOff builds the retry schedule: defaultRetryBaseDelay, doubling
// on every further attempt, without jitter.
func newPublishBackOff() *backoff.ExponentialBackOff {
	bo := backoff.NewExponentialBackOff()
	bo.InitialInterval = defaultRetryBaseDelay
	bo.Multiplier = defaultRetryMultiplier
	bo.RandomizationFactor = 0
	bo.MaxInterval = defaultRetryMaxInterval
	return bo
}

func (r *Runner) publishOne(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
	if r.publish != nil {
		return r.publish(ctx, row)
	}
	return r.publishEpisode(ctx, row)
}

func (r *Runner) notifyMembers(ctx context.Context, q *dbmodels.Queries, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
	if r.notify != nil {
		return r.notify(ctx, q, row)
	}
	return r.notifyMembersOfPublish(ctx, q, row)
}

func (r *Runner) notifyMembersOfPublish(ctx context.Context, q *dbmodels.Queries, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
	members, err := q.ListTenantMemberIDs(ctx, row.TenantID)
	if err != nil {
		return fmt.Errorf("list members: %w", err)
	}

	payload, err := json.Marshal(episodePublishedPayload{
		EpisodeID:    row.EpisodePublicID,
		EpisodeTitle: row.EpisodeTitle,
		SeriesID:     row.SeriesPublicID,
		SeriesTitle:  row.SeriesTitle,
	})
	if err != nil {
		return fmt.Errorf("encode payload: %w", err)
	}

	subjectKey := "episode:" + row.EpisodePublicID
	for _, memberID := range members {
		notificationID, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("allocate notification id: %w", err)
		}
		_, err = q.CreateNotification(ctx, dbmodels.CreateNotificationParams{
			ID:               notificationID,
			TenantID:         row.TenantID,
			UserID:           memberID,
			NotificationType: notificationTypeEpisodePublished,
			SubjectKey:       subjectKey,
			Payload:          payload,
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("insert notification for %s: %w", memberID, err)
		}
	}
	return nil
}

func (r *Runner) notifyTenantAdmins(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow, notificationType string) {
	admins, err := r.queries.ListTenantAdminIDs(ctx, row.TenantID)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list tenant admins for publish notification",
			"episode_id", row.EpisodeID,
			"tenant_id", row.TenantID.String(),
			"notification_type", notificationType,
			"error", err,
		)
		return
	}

	payload, err := json.Marshal(episodePublishedPayload{
		EpisodeID:    row.EpisodePublicID,
		EpisodeTitle: row.EpisodeTitle,
		SeriesID:     row.SeriesPublicID,
		SeriesTitle:  row.SeriesTitle,
	})
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to encode publish notification payload",
			"episode_id", row.EpisodeID,
			"tenant_id", row.TenantID.String(),
			"notification_type", notificationType,
			"error", err,
		)
		return
	}

	subjectKey := "episode:" + row.EpisodePublicID
	for _, adminID := range admins {
		notificationID, err := uuid.NewV7()
		if err != nil {
			r.logger.ErrorContext(ctx, "failed to allocate publish notification id",
				"episode_id", row.EpisodeID,
				"user_id", adminID,
				"notification_type", notificationType,
				"error", err,
			)
			continue
		}
		_, err = r.queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
			ID:               notificationID,
			TenantID:         row.TenantID,
			UserID:           adminID,
			NotificationType: notificationType,
			SubjectKey:       subjectKey,
			Payload:          payload,
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			r.logger.ErrorContext(ctx, "failed to insert publish notification",
				"episode_id", row.EpisodeID,
				"user_id", adminID,
				"notification_type", notificationType,
				"error", err,
			)
		}
	}
}

func (r *Runner) notifyOperatorsOfPublishFailure(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) {
	operators, err := r.queries.ListPlatformOperatorIDs(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list operators for publish-failed notification",
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
		r.logger.ErrorContext(ctx, "failed to encode publish-failed notification payload",
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
			r.logger.ErrorContext(ctx, "failed to allocate publish-failed notification id",
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
			r.logger.ErrorContext(ctx, "failed to insert publish-failed notification",
				"episode_id", row.EpisodeID,
				"platform_user_id", operatorID,
				"error", err,
			)
		}
	}
}

func (r *Runner) publishEpisode(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}

	qtx := r.queries.WithTx(tx)
	if err := qtx.MarkEpisodePublished(ctx, row.EpisodeID); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("mark episode published: %w", err)
	}
	if err := r.notifyMembers(ctx, qtx, row); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("notify members: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	if r.reval != nil {
		tenantID := row.TenantID.String()
		tags := []string{
			fmt.Sprintf("tenant:%s:series:detail", tenantID),
		}
		if err := r.reval.RevalidateTags(ctx, tenantID, row.TenantDomain, tags); err != nil {
			r.logger.WarnContext(ctx, "failed to revalidate after episode publish",
				"episode_id", row.EpisodeID,
				"tenant_id", tenantID,
				"error", err,
			)
		}
	}

	return nil
}
