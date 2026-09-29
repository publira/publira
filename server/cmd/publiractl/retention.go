package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/retention"
)

var retentionGroup = commandGroup{
	name:    "retention",
	summary: "Change how long each kind of expiring record is kept where a tenant has set nothing",
	commands: []command{
		{name: "set", summary: "Save the flags given over the retention defaults, keeping every other period", setup: setupRetentionSet},
		{name: "show", summary: "Print the retention defaults, or the built-in ones when none are saved", setup: setupRetentionShow},
	},
}

func retentionUsage(what string) string {
	return fmt.Sprintf("for how many `days` %s is kept, from 1 to %d, where a tenant has set none", what, retention.MaxDays)
}

// retentionFlags are the fields of the RetentionPeriods message.
var retentionFlags = []fieldFlag[retention.Periods]{
	{"withdrawn_comment_days", "withdrawn-comment-days", retentionUsage("a comment its author withdrew"),
		func(p *retention.Periods, v int) { p.WithdrawnCommentDays = v }},
	{"content_event_days", "content-event-days", retentionUsage("a raw engagement event"),
		func(p *retention.Periods, v int) { p.ContentEventDays = v }},
	{"daily_ranking_snapshot_days", "daily-ranking-snapshot-days", retentionUsage("a daily ranking snapshot"),
		func(p *retention.Periods, v int) { p.DailyRankingSnapshotDays = v }},
	{"weekly_ranking_snapshot_days", "weekly-ranking-snapshot-days", retentionUsage("a weekly ranking snapshot"),
		func(p *retention.Periods, v int) { p.WeeklyRankingSnapshotDays = v }},
}

var errNoRetentionFlag = errors.New("no period was given; name at least one with its flag")

func setupRetentionSet(f *commandFlags) func(context.Context, *commandEnv) error {
	flags := declareFieldFlags(f, retentionFlags)
	return func(ctx context.Context, env *commandEnv) error {
		if len(flags.edits) == 0 {
			return errNoRetentionFlag
		}
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		stored, revision, err := retention.ReadDefaults(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		params := retention.SaveDefaultsParams{Defaults: flags.apply(stored), ExpectedRevision: &revision}
		if err := params.Validate(); err != nil {
			return flags.named(retention.FieldDefaults, err)
		}
		saved, err := retention.SaveDefaults(ctx, db, env.logger, auditlog.SystemPlatformActor, params)
		if err != nil {
			return flags.named(retention.FieldDefaults, err)
		}
		_, err = fmt.Fprintf(env.stdout, "Saved the retention defaults, revision %d. Each purge applies them from its next run.\n", saved.Revision)
		return err
	}
}

func setupRetentionShow(_ *commandFlags) func(context.Context, *commandEnv) error {
	return func(ctx context.Context, env *commandEnv) error {
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		config, found, err := retention.GetDefaults(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		periods := retention.Builtin()
		if found {
			periods = retention.FromPlatformConfig(config)
		} else if _, err := fmt.Fprintln(env.stdout, "No retention defaults are saved, so these built-in ones apply"); err != nil {
			return err
		}
		var b strings.Builder
		fmt.Fprintf(&b, "Withdrawn comments:\t%d days\n", periods.WithdrawnCommentDays)
		fmt.Fprintf(&b, "Content events:\t%d days\n", periods.ContentEventDays)
		fmt.Fprintf(&b, "Daily ranking snapshots:\t%d days\n", periods.DailyRankingSnapshotDays)
		fmt.Fprintf(&b, "Weekly ranking snapshots:\t%d days\n", periods.WeeklyRankingSnapshotDays)
		if found {
			fmt.Fprintf(&b, "Revision:\t%d\n", config.Revision)
			fmt.Fprintf(&b, "Updated:\t%s\n", formatTime(config.UpdatedAt))
		}
		return printTable(env.stdout, b.String())
	}
}
