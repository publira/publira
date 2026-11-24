package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/platformtenants"
)

var outboxGroup = commandGroup{
	name:    "outbox",
	summary: "List the outbox events the worker gave up on, and requeue them",
	commands: []command{
		{name: "list", summary: "Print the dead outbox events, newest first", setup: setupOutboxList},
		{name: "requeue", summary: "Return dead outbox events to the queue, each on a whole retry budget", setup: setupOutboxRequeue},
	},
}

// lastErrorWidth is how much of an event's last error a list prints: enough to
// tell an unreachable SMTP server from a refused key, short enough to keep one
// event to one line.
const lastErrorWidth = 120

// deadEventFlags declares the flags that narrow the dead events a command acts
// on, and answers a function that resolves them once they are parsed.
func deadEventFlags(f *commandFlags) func(ctx context.Context, q dbmodels.Querier) (outbox.DeadEvents, error) {
	id := f.String("event", "", "one event, by ID")
	eventType := f.String("type", "", "every event of an event_type, such as contact_message_reply_email")
	tenant := f.String("tenant", "", "every event of a tenant, by public ID or domain")
	return func(ctx context.Context, q dbmodels.Querier) (outbox.DeadEvents, error) {
		filter := outbox.DeadEvents{EventType: strings.TrimSpace(*eventType)}
		if raw := strings.TrimSpace(*id); raw != "" {
			parsed, err := uuid.Parse(raw)
			if err != nil {
				return outbox.DeadEvents{}, fmt.Errorf("--event: %q is not an event ID", raw)
			}
			filter.ID = parsed
		}
		if strings.TrimSpace(*tenant) != "" {
			found, err := platformtenants.Find(ctx, q, *tenant)
			if err != nil {
				return outbox.DeadEvents{}, tenantError(err)
			}
			filter.TenantID = found.ID
		}
		return filter, nil
	}
}

func setupOutboxList(f *commandFlags) func(context.Context, *commandEnv) error {
	resolve := deadEventFlags(f)
	limit := f.Int("limit", 100, "the most events to print")
	return func(ctx context.Context, env *commandEnv) error {
		if *limit < 1 {
			return errors.New("--limit must be at least 1")
		}
		return env.inPlatformTx(ctx, func(tx *sql.Tx) error {
			q := dbmodels.New(tx)
			filter, err := resolve(ctx, q)
			if err != nil {
				return err
			}
			rows, err := outbox.ListDead(ctx, q, filter, int32(min(*limit, 1<<30)))
			if err != nil {
				return err
			}
			var b strings.Builder
			b.WriteString("ID\tTYPE\tTENANT\tATTEMPTS\tCREATED\tDIED\tLAST ERROR\n")
			for _, row := range rows {
				tenant := "-"
				if row.TenantPublicID.Valid {
					tenant = row.TenantPublicID.String
				}
				fmt.Fprintf(&b, "%s\t%s\t%s\t%d\t%s\t%s\t%s\n",
					row.ID, row.EventType, tenant, row.Attempts, formatTime(row.CreatedAt), formatTime(row.UpdatedAt), oneLine(row.LastError.String, lastErrorWidth))
			}
			return printTable(env.stdout, b.String())
		})
	}
}

func setupOutboxRequeue(f *commandFlags) func(context.Context, *commandEnv) error {
	resolve := deadEventFlags(f)
	all := f.Bool("all", false, "every dead event, when no other flag narrows them")
	return func(ctx context.Context, env *commandEnv) error {
		return env.inPlatformTx(ctx, func(tx *sql.Tx) error {
			q := dbmodels.New(tx)
			filter, err := resolve(ctx, q)
			if err != nil {
				return err
			}
			// Requeuing every dead event sends every mail an outage held up at
			// once, which is a choice to make by name rather than by leaving a
			// flag out.
			switch {
			case !filter.Any() && !*all:
				return errors.New("name the events with --event, --type, or --tenant, or requeue every dead event with --all")
			case filter.Any() && *all:
				return errors.New("--all requeues every dead event, so it takes no --event, --type, or --tenant")
			}
			requeued, err := outbox.RequeueDead(ctx, q, filter)
			var staysDead *outbox.StaysDeadError
			if errors.Is(err, outbox.ErrEventNotFound) || errors.Is(err, outbox.ErrEventNotDead) || errors.As(err, &staysDead) {
				return fmt.Errorf("--event: %w", err)
			}
			if err != nil {
				return err
			}
			for _, event := range requeued {
				if _, err := fmt.Fprintf(env.stdout, "Requeued %s (%s)\n", event.ID, event.EventType); err != nil {
					return err
				}
			}
			_, err = fmt.Fprintf(env.stdout, "Requeued %d dead %s\n", len(requeued), plural(len(requeued), "event", "events"))
			return err
		})
	}
}

// inPlatformTx runs fn in one transaction on the platform connection, and
// commits what fn wrote once it returns nil.
func (e *commandEnv) inPlatformTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	db, err := e.openPlatformDB()
	if err != nil {
		return err
	}
	defer db.Close() //nolint:errcheck
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// oneLine folds s onto one line of at most width runes, so a table row holds
// it.
func oneLine(s string, width int) string {
	s = strings.Join(strings.Fields(s), " ")
	if runes := []rune(s); len(runes) > width {
		return string(runes[:width-1]) + "…"
	}
	return s
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
