// Package secretrehint derives again the hint stored beside every sealed
// secret, from the secret itself, the way a save derives it now. A hint is
// derived once, when the secret is saved, so one saved before
// [secrethint] changed what a hint shows keeps showing that until the secret
// is saved again, and some are never saved again.
package secretrehint

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"sync"

	"github.com/jackc/pgx/v5"

	inboundproviders "github.com/publira/publira/server/internal/inboundprovider/providers"
	paymentproviders "github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/secrethint"
)

// DefaultBatchSize bounds the rows one transaction locks, as it does for
// secretreseal: a batch holds its rows only for as long as it takes to open
// their secrets.
const DefaultBatchSize = 500

// Opener opens a value with whichever configured key sealed it.
// [*secretcrypto.Manager] is one.
type Opener interface {
	DecryptString(value string) (string, error)
}

// Counts is what a run did with the hints of one table.
type Counts struct {
	// Rewritten is the hints a run wrote again, or that a dry run would have.
	Rewritten int
	// Current is the hints that already show what a save shows now.
	Current int
	// Unreadable is the hints of secrets no configured key opens, or that
	// open to a value no hint is derived from, which a run leaves as they are.
	Unreadable int
}

// Report is what a run found, by table.
type Report struct {
	Tables map[string]Counts
}

// Unreadable is the number of hints a run left as they are because their
// secret did not open or opened to a value no hint is derived from.
func (r Report) Unreadable() int {
	n := 0
	for _, c := range r.Tables {
		n += c.Unreadable
	}
	return n
}

func (r *Report) add(table string, add func(*Counts)) {
	if r.Tables == nil {
		r.Tables = map[string]Counts{}
	}
	c := r.Tables[table]
	add(&c)
	r.Tables[table] = c
}

// Options are the settings of one run.
type Options struct {
	// DryRun opens every secret and counts the hints a run would write again,
	// and writes nothing.
	DryRun bool
	// BatchSize is the number of rows one transaction reads, DefaultBatchSize
	// when zero.
	BatchSize int
	Logger    *slog.Logger
}

// column is a column of sealed secrets and the column of their hints, in a
// table whose rows are keyed by a uuid. A text column holds one secret and its
// hint; a jsonb one holds a document of field names to sealed values, beside
// a document of the same names to hints, and names the provider whose
// declaration says which of the fields are secret.
type column struct {
	table    string
	key      string
	sealed   string
	hint     string
	provider string
	// derive is the hint a save stores for plaintext, and false for a value
	// it cannot derive one from, whose hint is left as it is.
	derive func(plaintext string) (string, bool)
	// secret says whether provider declares field secret. A field that is not
	// secret has its value for a hint, which nothing here changes, and one
	// neither declared is left as it is.
	secret func(provider, field string) bool
}

func (c column) isDocument() bool {
	return c.provider != ""
}

// columns is every column a hint derived from a sealed secret is stored in.
// tenant_payment_config is not among them: it holds a copy of a tenant's
// first payment provider, which the trigger on tenant_payment_providers
// writes again when that row's hints are.
var columns = []column{
	{table: "tenant_app_store_config", key: "tenant_id", sealed: "private_key_encrypted", hint: "private_key_hint", derive: privateKeyHint},
	{table: "tenant_apple_sign_in_config", key: "tenant_id", sealed: "private_key_encrypted", hint: "private_key_hint", derive: privateKeyHint},
	{table: "tenant_google_play_config", key: "tenant_id", sealed: "service_account_key_encrypted", hint: "service_account_key_hint", derive: serviceAccountKeyHint},
	{table: "tenant_inbound_email_config", key: "tenant_id", sealed: "credentials_encrypted", hint: "credential_hints", provider: "provider", derive: maskHint, secret: inboundFieldSecret},
	{table: "tenant_payment_providers", key: "id", sealed: "credentials_encrypted", hint: "credential_hints", provider: "provider", derive: maskHint, secret: paymentFieldSecret},
	{table: "tenant_webhook_endpoints", key: "id", sealed: "secret_encrypted", hint: "secret_hint", derive: maskHint},
}

func maskHint(plaintext string) (string, bool) {
	hint := secrethint.Mask(plaintext)
	return hint, hint != ""
}

func privateKeyHint(plaintext string) (string, bool) {
	hint := secrethint.PrivateKey(plaintext)
	return hint, hint != ""
}

// serviceAccountKeyHint is the hint of a Google Play service account key,
// which names the key by its private_key_id.
func serviceAccountKeyHint(plaintext string) (string, bool) {
	var key struct {
		PrivateKeyID string `json:"private_key_id"`
	}
	if err := json.Unmarshal([]byte(plaintext), &key); err != nil {
		return "", false
	}
	return maskHint(key.PrivateKeyID)
}

var (
	paymentRegistry = sync.OnceValue(paymentproviders.Registry)
	inboundRegistry = sync.OnceValue(inboundproviders.Registry)
)

func paymentFieldSecret(provider, field string) bool {
	p, ok := paymentRegistry().Lookup(provider)
	if !ok {
		return false
	}
	f, ok := p.Declaration().Field(field)
	return ok && f.Secret
}

func inboundFieldSecret(provider, field string) bool {
	p, ok := inboundRegistry().Lookup(provider)
	if !ok {
		return false
	}
	f, ok := p.Declaration().Field(field)
	return ok && f.Secret
}

// Run opens every secret in every column of [columns] and writes again each
// hint that differs from the one a save of the same secret stores now. A
// secret no configured key opens is logged, counted, and its hint left as it
// is. It runs beside the serving processes: each batch locks the rows it
// reads until it commits, so a save that arrives meanwhile waits for it, and
// the hint it writes is the hint of the secret the row holds.
func Run(ctx context.Context, db *sql.DB, opener Opener, opts Options) (Report, error) {
	if opts.BatchSize <= 0 {
		opts.BatchSize = DefaultBatchSize
	}
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	var report Report
	for _, c := range columns {
		if err := rehintColumn(ctx, db, opener, opts, c, &report); err != nil {
			return report, fmt.Errorf("%s.%s: %w", c.table, c.hint, err)
		}
	}
	return report, nil
}

type row struct {
	key      string
	provider string
	sealed   string
	hint     string
}

func rehintColumn(ctx context.Context, db *sql.DB, opener Opener, opts Options, c column, report *Report) error {
	table := pgx.Identifier{c.table}.Sanitize()
	key := pgx.Identifier{c.key}.Sanitize()
	sealed := pgx.Identifier{c.sealed}.Sanitize()
	hint := pgx.Identifier{c.hint}.Sanitize()
	provider := "''"
	if c.isDocument() {
		provider = pgx.Identifier{c.provider}.Sanitize()
	}
	selectBatch := fmt.Sprintf(
		`SELECT %[2]s::text, %[5]s::text, %[3]s::text, coalesce(%[4]s::text, '') FROM %[1]s
		 WHERE ($1::uuid IS NULL OR %[2]s > $1::uuid) AND %[3]s IS NOT NULL
		 ORDER BY %[2]s LIMIT $2`,
		table, key, sealed, hint, provider)
	if !opts.DryRun {
		selectBatch += " FOR UPDATE"
	}
	update := fmt.Sprintf(`UPDATE %[1]s SET %[3]s = $1 WHERE %[2]s = $2::uuid`, table, key, hint)
	if c.isDocument() {
		update = fmt.Sprintf(`UPDATE %[1]s SET %[3]s = $1::jsonb WHERE %[2]s = $2::uuid`, table, key, hint)
	}

	var after sql.NullString
	for {
		n, last, err := rehintBatch(ctx, db, opts, selectBatch, update, after, func(r row) (string, bool, error) {
			return rehintRow(opener, opts.Logger, report, c, r)
		})
		if err != nil {
			return err
		}
		if n < opts.BatchSize {
			return nil
		}
		after = sql.NullString{String: last, Valid: true}
	}
}

// rehintBatch reads one batch after the key after in a transaction of its own,
// writes the hints rehint changes, and returns how many rows it read and the
// key of the last.
func rehintBatch(
	ctx context.Context,
	db *sql.DB,
	opts Options,
	selectBatch, update string,
	after sql.NullString,
	rehint func(row) (string, bool, error),
) (int, string, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: opts.DryRun})
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback() //nolint:errcheck

	rows, err := tx.QueryContext(ctx, selectBatch, after, opts.BatchSize)
	if err != nil {
		return 0, "", err
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.key, &r.provider, &r.sealed, &r.hint); err != nil {
			_ = rows.Close()
			return 0, "", err
		}
		batch = append(batch, r)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return 0, "", err
	}

	for _, r := range batch {
		hint, changed, err := rehint(r)
		if err != nil {
			return 0, "", err
		}
		if !changed || opts.DryRun {
			continue
		}
		if _, err := tx.ExecContext(ctx, update, hint, r.key); err != nil {
			return 0, "", err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, "", err
	}
	if len(batch) == 0 {
		return 0, "", nil
	}
	return len(batch), batch[len(batch)-1].key, nil
}

// rehintRow answers what the hint column of r should hold, and whether that
// differs from what it holds.
func rehintRow(opener Opener, logger *slog.Logger, report *Report, c column, r row) (string, bool, error) {
	if !c.isDocument() {
		hint, ok := deriveHint(opener, logger, report, c, r.key, "", r.sealed, r.hint)
		if !ok || hint == r.hint {
			return r.hint, false, nil
		}
		return hint, true, nil
	}

	var sealed, hints map[string]string
	if err := json.Unmarshal([]byte(r.sealed), &sealed); err != nil {
		return "", false, fmt.Errorf("decode %s of row %s: %w", c.sealed, r.key, err)
	}
	if r.hint != "" {
		if err := json.Unmarshal([]byte(r.hint), &hints); err != nil {
			return "", false, fmt.Errorf("decode %s of row %s: %w", c.hint, r.key, err)
		}
	}
	if hints == nil {
		hints = map[string]string{}
	}
	changed := false
	for _, field := range slices.Sorted(maps.Keys(sealed)) {
		if !c.secret(r.provider, field) {
			continue
		}
		hint, ok := deriveHint(opener, logger, report, c, r.key, field, sealed[field], hints[field])
		if !ok || hint == hints[field] {
			continue
		}
		hints[field] = hint
		changed = true
	}
	if !changed {
		return r.hint, false, nil
	}
	encoded, err := json.Marshal(hints)
	if err != nil {
		return "", false, fmt.Errorf("encode %s of row %s: %w", c.hint, r.key, err)
	}
	return string(encoded), true, nil
}

// deriveHint opens envelope and derives its hint, counting whether it differs
// from stored, the hint the row holds for it.
func deriveHint(opener Opener, logger *slog.Logger, report *Report, c column, rowKey, field, envelope, stored string) (string, bool) {
	attrs := []any{"table", c.table, c.key, rowKey}
	if field != "" {
		attrs = append(attrs, "field", field)
	}
	plaintext, err := opener.DecryptString(envelope)
	if err != nil {
		report.add(c.table, func(c *Counts) { c.Unreadable++ })
		logger.Warn("left the hint of a secret no configured key opens as it is", append(attrs, "error", err)...)
		return "", false
	}
	hint, ok := c.derive(plaintext)
	if !ok {
		report.add(c.table, func(c *Counts) { c.Unreadable++ })
		logger.Warn("left the hint of a secret no hint is derived from as it is", attrs...)
		return "", false
	}
	if hint == stored {
		report.add(c.table, func(c *Counts) { c.Current++ })
	} else {
		report.add(c.table, func(c *Counts) { c.Rewritten++ })
	}
	return hint, true
}
