package tenanterasure

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"slices"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// keptTables are the tables with a tenant_id column whose rows outlive the
// tenant. The platform audit log is the platform's record, and keeps the
// entries of the deletion itself.
var keptTables = []string{"platform_audit_logs"}

// auditLogTable is the tenant's own audit log, which is append-only for the
// role the erasure connects as and is deleted through
// erase_tenant_audit_logs instead.
const auditLogTable = "audit_logs"

// maxRounds bounds how many times the tables are walked. A delete can fire a
// trigger that writes to a table already walked — an unfollow records a
// follower change — so a second round finds what the first left behind, and a
// round that deletes nothing ends the walk. One that still deletes after this
// many is a trigger writing for every row it is given, which no further round
// would drain.
const maxRounds = 5

// table is one table the tenant holds rows in.
type table struct {
	name string
	// ident is name quoted as an identifier.
	ident string
}

// listTables answers every table holding a tenant_id column that the erasure
// deletes from, in an order where a table comes before every table its
// foreign keys restrict or cascade from. The schema is read rather than
// listed here, so a table a later migration adds is erased the day it lands.
//
// A foreign key that sets the reference to NULL places nothing: deleting the
// referenced row first only updates the referencing one. Those are what close
// the cycles between an owner and its images, so leaving them out leaves an
// order to find.
//
// A table the connection may not delete from is left out. Its rows go with the
// tenant row, through its foreign key's cascade: tenant_fcm_config, whose
// sealed key the maintenance role may not even read, is the one.
func listTables(ctx context.Context, db *sql.DB) ([]table, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT c.relname, quote_ident(c.relname)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_attribute a ON a.attrelid = c.oid
			AND a.attname = 'tenant_id'
			AND NOT a.attisdropped
		WHERE n.nspname = 'public'
			AND c.relkind IN ('r', 'p')
			AND NOT c.relispartition
			AND c.relname <> ALL ($1::text[])
			AND (c.relname = $2 OR has_table_privilege(c.oid, 'DELETE'))
		ORDER BY c.relname
	`, keptTables, auditLogTable)
	if err != nil {
		return nil, fmt.Errorf("list the tenant tables: %w", err)
	}
	defer rows.Close() //nolint:errcheck
	var tables []table
	for rows.Next() {
		var t table
		if err := rows.Scan(&t.name, &t.ident); err != nil {
			return nil, fmt.Errorf("list the tenant tables: %w", err)
		}
		tables = append(tables, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list the tenant tables: %w", err)
	}

	edges, err := db.QueryContext(ctx, `
		SELECT child.relname, parent.relname
		FROM pg_constraint k
		JOIN pg_class child ON child.oid = k.conrelid
		JOIN pg_class parent ON parent.oid = k.confrelid
		JOIN pg_namespace n ON n.oid = child.relnamespace
		WHERE k.contype = 'f'
			AND n.nspname = 'public'
			AND k.conrelid <> k.confrelid
			AND k.confdeltype NOT IN ('n', 'd')
	`)
	if err != nil {
		return nil, fmt.Errorf("list the tenant tables' foreign keys: %w", err)
	}
	defer edges.Close() //nolint:errcheck
	parents := map[string][]string{}
	for edges.Next() {
		var child, parent string
		if err := edges.Scan(&child, &parent); err != nil {
			return nil, fmt.Errorf("list the tenant tables' foreign keys: %w", err)
		}
		parents[child] = append(parents[child], parent)
	}
	if err := edges.Err(); err != nil {
		return nil, fmt.Errorf("list the tenant tables' foreign keys: %w", err)
	}
	return childrenFirst(tables, parents)
}

// childrenFirst orders tables so that each comes before every table it names
// in parents, keeping the given order among tables nothing orders. A cycle is
// an error: it would take a foreign key that restricts in both directions,
// which no order of deletes can satisfy.
func childrenFirst(tables []table, parents map[string][]string) ([]table, error) {
	present := make(map[string]bool, len(tables))
	for _, t := range tables {
		present[t.name] = true
	}
	// children[p] are the tables that must be emptied before p.
	children := map[string][]string{}
	waiting := map[string]int{}
	for _, t := range tables {
		for _, parent := range parents[t.name] {
			if present[parent] && !slices.Contains(children[parent], t.name) {
				children[parent] = append(children[parent], t.name)
				waiting[parent]++
			}
		}
	}
	byName := make(map[string]table, len(tables))
	for _, t := range tables {
		byName[t.name] = t
	}
	ordered := make([]table, 0, len(tables))
	done := map[string]bool{}
	for len(ordered) < len(tables) {
		progressed := false
		for _, t := range tables {
			if done[t.name] || waiting[t.name] > 0 {
				continue
			}
			done[t.name] = true
			ordered = append(ordered, t)
			progressed = true
			for _, parent := range parents[t.name] {
				if present[parent] {
					waiting[parent]--
				}
			}
		}
		if !progressed {
			var stuck []string
			for _, t := range tables {
				if !done[t.name] {
					stuck = append(stuck, t.name)
				}
			}
			return nil, fmt.Errorf("the foreign keys between %v leave no order to delete them in", stuck)
		}
	}
	return ordered, nil
}

// eraseRows deletes every row the tenant holds in tables, which listTables
// answered, batchSize rows to a statement, each statement committing on its
// own. Nothing is held across batches, so a pass a crash cut short is taken up
// by the next one where it stopped, and the tenant row, which nothing here
// deletes, keeps naming what is left.
func eraseRows(ctx context.Context, db *sql.DB, logger *slog.Logger, tables []table, tenantID uuid.UUID, batchSize int) error {
	q := dbmodels.New(db)
	for round := 1; ; round++ {
		var deleted int64
		for _, t := range tables {
			n, err := eraseTable(ctx, db, q, t, tenantID, batchSize)
			if err != nil {
				return err
			}
			if n > 0 {
				logger.InfoContext(ctx, "tenant rows erased", "table", t.name, "rows", n, "round", round)
			}
			deleted += n
		}
		if deleted == 0 {
			return nil
		}
		if round == maxRounds {
			return fmt.Errorf("rows of the tenant were still being written after %d rounds", maxRounds)
		}
	}
}

// eraseTable deletes the tenant's rows from t until none is left.
func eraseTable(ctx context.Context, db *sql.DB, q *dbmodels.Queries, t table, tenantID uuid.UUID, batchSize int) (int64, error) {
	statement := fmt.Sprintf(`
		DELETE FROM public.%[1]s
		WHERE ctid = ANY (ARRAY(
			SELECT ctid
			FROM public.%[1]s
			WHERE tenant_id = $1
			LIMIT $2
		))`, t.ident)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		var n int64
		if t.name == auditLogTable {
			erased, err := q.EraseTenantAuditLogs(ctx, dbmodels.EraseTenantAuditLogsParams{TenantID: tenantID, BatchSize: int32(batchSize)})
			if err != nil {
				return total, fmt.Errorf("erase the tenant's rows from %s: %w", t.name, err)
			}
			n = erased
		} else {
			result, err := db.ExecContext(ctx, statement, tenantID, batchSize)
			if err != nil {
				return total, fmt.Errorf("erase the tenant's rows from %s: %w", t.name, err)
			}
			if n, err = result.RowsAffected(); err != nil {
				return total, fmt.Errorf("erase the tenant's rows from %s: %w", t.name, err)
			}
		}
		total += n
		if n < int64(batchSize) {
			return total, nil
		}
	}
}
