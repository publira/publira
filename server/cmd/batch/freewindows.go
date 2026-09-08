// The apply-free-windows subcommand. Every other subcommand's file is named
// after it; this one is not, because Go builds a file whose name ends in
// _windows.go only for GOOS=windows.
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
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/freewindows"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/sqldb"
)

const defaultFreeWindowIntervalSeconds = 60

func runApplyFreeWindows(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	db, err := sqldb.Open(cfg.DB.URL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	interval := resolveFreeWindowInterval()

	revalidateToken := strings.TrimSpace(os.Getenv("PUBLIRA_REVALIDATE_TOKEN"))
	reval, revalidateErr := revalidate.NewClient(revalidateToken, logger)
	if revalidateErr != nil {
		logger.Warn("next revalidate is disabled", "reason", revalidateErr.Error())
	} else if reval == nil {
		logger.Info("next revalidate is disabled", "reason", "PUBLIRA_REVALIDATE_TOKEN is empty")
	}

	runner := freewindows.New(dbmodels.New(db), reval, logger)

	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("apply-free-windows worker started", "interval", interval)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately on startup, then on each tick. A restart therefore
	// catches up on every boundary crossed while the process was down.
	runner.RunOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			logger.Info("shutting down apply-free-windows worker")
			return nil
		case <-ticker.C:
			runner.RunOnce(ctx)
		}
	}
}

func resolveFreeWindowInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_FREE_WINDOW_INTERVAL_SECONDS"))
	if raw == "" {
		return defaultFreeWindowIntervalSeconds * time.Second
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultFreeWindowIntervalSeconds * time.Second
	}
	return time.Duration(n) * time.Second
}
