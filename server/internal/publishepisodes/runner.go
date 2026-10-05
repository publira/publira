// Package publishepisodes publishes scheduled episodes and writes follower
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
	"time"

	"github.com/cenkalti/backoff/v7"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/publira/publira/server/internal/catalogindex"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/revalidate"
)

const (
	defaultRetryBaseDelay  = 2 * time.Second
	defaultRetryMultiplier = 2

	notificationTypeEpisodePublishFailed = "episode_publish_failed"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/publishepisodes")

// Runner lists due scheduled episodes and publishes them with retries.
type Runner struct {
	db         *sql.DB
	queries    *dbmodels.Queries
	reval      *revalidate.Requester
	logger     *slog.Logger
	maxRetries int
	// followerPageSize bounds one recipient query. New sets it to
	// outbox.DefaultEpisodeFollowerPageSize; a test lowers it to walk several pages without
	// seeding a page's worth of readers.
	followerPageSize int32
	// publish, when set, replaces publishEpisode so tests can force a final failure.
	publish func(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error
	// notify, when set, replaces notifyFollowersOfPublish so tests can force a
	// failure after the listing is marked published and before commit.
	notify func(ctx context.Context, q *dbmodels.Queries, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error
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
func New(db *sql.DB, queries *dbmodels.Queries, reval *revalidate.Requester, logger *slog.Logger, maxRetries int) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	if queries == nil {
		queries = dbmodels.New(db)
	}
	if maxRetries < 0 {
		// WithMaxTries takes a uint, where 0 means "keep retrying forever".
		// Clamp here so a negative budget stays a single attempt.
		maxRetries = 0
	}
	return &Runner{
		db:               db,
		queries:          queries,
		reval:            reval,
		logger:           logger,
		maxRetries:       maxRetries,
		followerPageSize: outbox.DefaultEpisodeFollowerPageSize,
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
	r.notifyTenantAdmins(ctx, row, outbox.NotificationTypeEpisodePublished)
}

// newPublishBackOff builds the retry schedule: defaultRetryBaseDelay doubling on
// every further attempt. The library's randomization, interval ceiling, and total
// elapsed limit are left at their defaults.
func newPublishBackOff() *backoff.ExponentialBackOff {
	bo := backoff.NewExponentialBackOff()
	bo.InitialInterval = defaultRetryBaseDelay
	bo.Multiplier = defaultRetryMultiplier
	return bo
}

func (r *Runner) publishOne(ctx context.Context, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
	if r.publish != nil {
		return r.publish(ctx, row)
	}
	return r.publishEpisode(ctx, row)
}

func (r *Runner) notifyFollowers(ctx context.Context, q *dbmodels.Queries, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
	if r.notify != nil {
		return r.notify(ctx, q, row)
	}
	return r.notifyFollowersOfPublish(ctx, q, row)
}

// notifyFollowersOfPublish tells the followers of the episode inside the
// publishing transaction, so a failure half way leaves neither the
// notifications nor the published listing behind.
func (r *Runner) notifyFollowersOfPublish(ctx context.Context, q *dbmodels.Queries, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
	return outbox.NotifyEpisodeFollowers(ctx, q, outbox.EpisodePublication{
		TenantID:        row.TenantID,
		EpisodeID:       row.EpisodeID,
		EpisodePublicID: row.EpisodePublicID,
		EpisodeTitle:    row.EpisodeTitle,
		SeriesPublicID:  row.SeriesPublicID,
		SeriesTitle:     row.SeriesTitle,
	}, r.followerPageSize)
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

	payload, err := json.Marshal(outbox.EpisodePublishedNotificationBody{
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
		err = r.queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
			ID:               notificationID,
			TenantID:         row.TenantID,
			UserID:           adminID,
			NotificationType: notificationType,
			SubjectKey:       subjectKey,
			Payload:          payload,
		})
		if err != nil {
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
	if err := r.notifyFollowers(ctx, qtx, row); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("notify followers: %w", err)
	}
	// The drop rides the transaction that promotes the listing: a run that dies
	// between the two would otherwise leave an episode published behind a cache
	// still answering with the schedule.
	if _, err := r.reval.Record(ctx, qtx, row.TenantID, []string{
		fmt.Sprintf("tenant:%s:series:detail", row.TenantID.String()),
	}); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("record cache invalidation: %w", err)
	}
	// So does the sync of the series' search document, whose latest episode,
	// and whether a free episode is open, may have changed with this one.
	if err := catalogindex.Queue(ctx, qtx, row.TenantID, catalogindex.SeriesRef(row.SeriesID)); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("queue catalog index sync: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}
