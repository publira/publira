// Package secretreseal moves every sealed value the database holds onto the
// primary encryption key. A value moves when it is saved again, and some never
// are: a member of staff's authenticator secret, the refresh token of a Sign in
// with Apple link, the Web Push key pair. Until every one of them has moved,
// the key that sealed it cannot be taken out of the configuration, which is
// what rotating a key after a leak is for.
package secretreseal

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/publira/publira/server/internal/secretcrypto"
)

// DefaultBatchSize bounds the rows one transaction locks. A batch holds its
// rows only for as long as it takes to open and seal their values, so a
// sign-in that reads one of them waits that long at most.
const DefaultBatchSize = 500

// Sealer opens a value with whichever configured key sealed it and seals one
// with the primary key. [*secretcrypto.Manager] is one.
type Sealer interface {
	DecryptString(value string) (string, error)
	EncryptString(plaintext string) (string, error)
	EncryptedWithPrimary(value string) bool
}

// Column is a column that holds sealed values, with the single-column primary
// key a row of it is updated by.
type Column struct {
	Table string
	Name  string
	// Type is the column's type as format_type spells it: text, or jsonb for a
	// document whose sealed string values are sealed one by one.
	Type    string
	Key     string
	KeyType string
}

func (c Column) String() string {
	return c.Table + "." + c.Name
}

func (c Column) isDocument() bool {
	return c.Type == "jsonb"
}

// sealedSuffix ends the name of a column, or of a member of a document, that
// holds sealed values.
const sealedSuffix = "_encrypted"

// sealsEveryString reports whether every string in a document of the column
// is sealed, as it is in a column named for holding sealed values. The other
// documents, outbox payloads, also carry strings a reader or a tenant wrote,
// which may start like an envelope without being one, so only a member named
// for holding a sealed value is opened there.
func (c Column) sealsEveryString() bool {
	return strings.HasSuffix(c.Name, sealedSuffix)
}

// Counts is what a run did with the values one key sealed.
type Counts struct {
	// Resealed is the values sealed with this key that a run sealed again with
	// the primary key, or that a dry run would have.
	Resealed int
	// Current is the values sealed with the primary key already, which a run
	// opens to prove it can and otherwise leaves alone.
	Current int
	// Unreadable is the values no configured key opens, which a run leaves as
	// they are.
	Unreadable int
}

// Report is what a run found, by the ID of the key each value names. A value
// that names no key ID at all is counted under "".
type Report struct {
	Keys map[string]Counts
}

// Unreadable is the number of values no configured key opens.
func (r Report) Unreadable() int {
	n := 0
	for _, c := range r.Keys {
		n += c.Unreadable
	}
	return n
}

func (r *Report) add(keyID string, add func(*Counts)) {
	if r.Keys == nil {
		r.Keys = map[string]Counts{}
	}
	c := r.Keys[keyID]
	add(&c)
	r.Keys[keyID] = c
}

// Options are the settings of one run.
type Options struct {
	// DryRun opens every value and counts what a run would seal again, and
	// writes nothing.
	DryRun bool
	// BatchSize is the number of rows one transaction reads, DefaultBatchSize
	// when zero.
	BatchSize int
	Logger    *slog.Logger
}

// sealedColumnsQuery finds every column a sealed value is stored in: by
// convention one whose name ends in _encrypted, and the payload of an outbox
// event, which carries a sealed value to the worker, in a member named the same
// way, when the row it came from is gone by the time the event is sent. The convention, rather than a list,
// is what keeps a column added later covered the day it lands.
const sealedColumnsQuery = `
SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
       coalesce(k.attname, ''), coalesce(format_type(k.atttypid, k.atttypmod), '')
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p') AND NOT c.relispartition
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary AND i.indnkeyatts = 1
LEFT JOIN pg_attribute k ON k.attrelid = c.oid AND k.attnum = i.indkey[0]
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND (a.attname LIKE '%\_encrypted' OR (c.relname = 'outbox_events' AND a.attname = 'payload'))
ORDER BY c.relname, a.attname`

// SealedColumns lists every column a sealed value is stored in. A column that
// is neither text nor jsonb, or whose table has no single-column primary key,
// is refused rather than skipped: a run that left it out would report a
// database as rotated while it still held values sealed with the old key.
func SealedColumns(ctx context.Context, db *sql.DB) ([]Column, error) {
	rows, err := db.QueryContext(ctx, sealedColumnsQuery)
	if err != nil {
		return nil, fmt.Errorf("list the columns that hold sealed values: %w", err)
	}
	defer rows.Close() //nolint:errcheck
	var columns []Column
	for rows.Next() {
		var c Column
		if err := rows.Scan(&c.Table, &c.Name, &c.Type, &c.Key, &c.KeyType); err != nil {
			return nil, fmt.Errorf("list the columns that hold sealed values: %w", err)
		}
		if c.Type != "text" && c.Type != "jsonb" {
			return nil, fmt.Errorf("%s is %s, and only a text or jsonb column can hold a sealed value", c, c.Type)
		}
		if c.Key == "" {
			return nil, fmt.Errorf("%s has no single-column primary key to update a row of it by", c.Table)
		}
		columns = append(columns, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list the columns that hold sealed values: %w", err)
	}
	return columns, nil
}

// Run opens every sealed value in every column [SealedColumns] lists and seals
// the ones a key other than the primary sealed again with the primary key, in
// place and with the same plaintext. A value no configured key opens is
// logged, counted, and left as it is. It runs beside the serving processes:
// each batch locks the rows it rewrites until it commits, so a save that
// arrives meanwhile waits for it rather than being overwritten by it.
func Run(ctx context.Context, db *sql.DB, sealer Sealer, opts Options) (Report, error) {
	if opts.BatchSize <= 0 {
		opts.BatchSize = DefaultBatchSize
	}
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	columns, err := SealedColumns(ctx, db)
	if err != nil {
		return Report{}, err
	}
	var report Report
	for _, c := range columns {
		if err := resealColumn(ctx, db, sealer, opts, c, &report); err != nil {
			return report, fmt.Errorf("%s: %w", c, err)
		}
	}
	return report, nil
}

func resealColumn(ctx context.Context, db *sql.DB, sealer Sealer, opts Options, c Column, report *Report) error {
	table := pgx.Identifier{c.Table}.Sanitize()
	column := pgx.Identifier{c.Name}.Sanitize()
	key := pgx.Identifier{c.Key}.Sanitize()
	// Rows are walked in key order, a batch at a time, and only those whose
	// value holds an envelope are read. A dry run takes no lock.
	selectBatch := fmt.Sprintf(
		`SELECT %[3]s::text, %[2]s::text FROM %[1]s
		 WHERE ($1::text IS NULL OR %[3]s > $1::text::%[4]s) AND %[2]s::text LIKE $2
		 ORDER BY %[3]s LIMIT $3`,
		table, column, key, c.KeyType)
	if !opts.DryRun {
		selectBatch += " FOR UPDATE"
	}
	update := fmt.Sprintf(`UPDATE %[1]s SET %[2]s = $1::text::%[4]s WHERE %[3]s = $2::text::%[5]s`,
		table, column, key, c.Type, c.KeyType)
	pattern := "%" + secretcrypto.EnvelopeV1Prefix + "%"

	var after sql.NullString
	for {
		n, last, err := resealBatch(ctx, db, opts, selectBatch, update, pattern, after, func(rowKey, value string) (string, bool, error) {
			return resealValue(sealer, opts.Logger, report, c, rowKey, value)
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

// resealBatch reads one batch after the key after in a transaction of its own,
// rewrites the rows reseal changes, and returns how many rows it read and the
// key of the last.
func resealBatch(
	ctx context.Context,
	db *sql.DB,
	opts Options,
	selectBatch, update, pattern string,
	after sql.NullString,
	reseal func(rowKey, value string) (string, bool, error),
) (int, string, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: opts.DryRun})
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback() //nolint:errcheck

	type row struct{ key, value string }
	rows, err := tx.QueryContext(ctx, selectBatch, after, pattern, opts.BatchSize)
	if err != nil {
		return 0, "", err
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.key, &r.value); err != nil {
			_ = rows.Close()
			return 0, "", err
		}
		batch = append(batch, r)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return 0, "", err
	}

	for _, r := range batch {
		resealed, changed, err := reseal(r.key, r.value)
		if err != nil {
			return 0, "", err
		}
		if !changed || opts.DryRun {
			continue
		}
		if _, err := tx.ExecContext(ctx, update, resealed, r.key); err != nil {
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

// resealValue is value with every envelope in it sealed with the primary key,
// and whether that changed anything. A text column holds one envelope; a jsonb
// column holds one per sealed string value, as [Column.sealsEveryString] tells
// them apart.
func resealValue(sealer Sealer, logger *slog.Logger, report *Report, c Column, rowKey, value string) (string, bool, error) {
	open := func(path, envelope string) (string, error) {
		return resealEnvelope(sealer, logger, report, c, rowKey, path, envelope)
	}
	if !c.isDocument() {
		if !secretcrypto.IsEncryptedEnvelope(value) {
			return value, false, nil
		}
		resealed, err := open("", value)
		if err != nil {
			return "", false, err
		}
		return resealed, resealed != value, nil
	}

	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.UseNumber()
	var doc any
	if err := decoder.Decode(&doc); err != nil {
		return "", false, fmt.Errorf("decode the document of row %s: %w", rowKey, err)
	}
	doc, changed, err := resealDocument(doc, "$", c.sealsEveryString(), open)
	if err != nil {
		return "", false, err
	}
	if !changed {
		return value, false, nil
	}
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(doc); err != nil {
		return "", false, fmt.Errorf("encode the document of row %s: %w", rowKey, err)
	}
	return strings.TrimSuffix(out.String(), "\n"), true, nil
}

// resealDocument walks a decoded JSON document and passes every sealed string
// that is an envelope, with its JSON path, to open. A string is sealed when
// sealed is true, which it is for the whole document of a column named for
// holding sealed values and for whatever a member named that way holds.
func resealDocument(node any, path string, sealed bool, open func(path, envelope string) (string, error)) (any, bool, error) {
	switch v := node.(type) {
	case string:
		if !sealed || !secretcrypto.IsEncryptedEnvelope(v) {
			return v, false, nil
		}
		resealed, err := open(path, v)
		return resealed, resealed != v, err
	case map[string]any:
		changed := false
		for k, child := range v {
			next, c, err := resealDocument(child, path+"."+k, sealed || strings.HasSuffix(k, sealedSuffix), open)
			if err != nil {
				return nil, false, err
			}
			v[k] = next
			changed = changed || c
		}
		return v, changed, nil
	case []any:
		changed := false
		for i, child := range v {
			next, c, err := resealDocument(child, fmt.Sprintf("%s[%d]", path, i), sealed, open)
			if err != nil {
				return nil, false, err
			}
			v[i] = next
			changed = changed || c
		}
		return v, changed, nil
	default:
		return v, false, nil
	}
}

// resealEnvelope opens envelope and returns it sealed with the primary key, or
// as it is when the primary key sealed it already or no configured key opens
// it.
func resealEnvelope(sealer Sealer, logger *slog.Logger, report *Report, c Column, rowKey, path, envelope string) (string, error) {
	keyID, _ := secretcrypto.EnvelopeKeyID(envelope)
	plaintext, err := sealer.DecryptString(envelope)
	if err != nil {
		report.add(keyID, func(c *Counts) { c.Unreadable++ })
		attrs := []any{"column", c.String(), c.Key, rowKey, "key_id", keyID, "error", err}
		if path != "" {
			attrs = append(attrs, "path", path)
		}
		logger.Warn("left a sealed value no configured key opens as it is", attrs...)
		return envelope, nil
	}
	if sealer.EncryptedWithPrimary(envelope) {
		report.add(keyID, func(c *Counts) { c.Current++ })
		return envelope, nil
	}
	resealed, err := sealer.EncryptString(plaintext)
	if err != nil {
		return "", fmt.Errorf("seal the value of row %s with the primary key: %w", rowKey, err)
	}
	report.add(keyID, func(c *Counts) { c.Resealed++ })
	return resealed, nil
}
