package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/dayroll"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tenantday"
)

const defaultTenantDayIntervalSeconds = 60

func runRollTenantDay(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	db, err := sqldb.Open(cfg.DB.URL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	interval := resolveTenantDayInterval()

	revalidateToken := strings.TrimSpace(os.Getenv("PUBLIRA_REVALIDATE_TOKEN"))
	reval, revalidateErr := revalidate.NewClient(revalidateToken, logger)
	if revalidateErr != nil {
		logger.Warn("next revalidate is disabled", "reason", revalidateErr.Error())
	} else if reval == nil {
		logger.Info("next revalidate is disabled", "reason", "PUBLIRA_REVALIDATE_TOKEN is empty")
	}

	runner := dayroll.New(func(ctx context.Context) ([]tenantday.Tenant, error) {
		return tenantday.List(ctx, db)
	}, reval, logger)

	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("roll-tenant-day worker started", "interval", interval)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately on startup, then on each tick. The first pass turns
	// every tenant over, because a process that has just come up knows nothing
	// about the midnights it was down for.
	runner.RunOnce(ctx, time.Now())

	for {
		select {
		case <-ctx.Done():
			logger.Info("shutting down roll-tenant-day worker")
			return nil
		case now := <-ticker.C:
			runner.RunOnce(ctx, now)
		}
	}
}

func resolveTenantDayInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_TENANT_DAY_INTERVAL_SECONDS"))
	if raw == "" {
		return defaultTenantDayIntervalSeconds * time.Second
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultTenantDayIntervalSeconds * time.Second
	}
	return time.Duration(n) * time.Second
}
