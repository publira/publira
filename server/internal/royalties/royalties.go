// Package royalties closes a tenant month of sales into a royalty statement
// and previews a month that is not closed yet. The console's close RPC and the
// batch's automatic close both go through CloseStatement, so a month is closed
// by the same rules whoever closes it.
package royalties

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
)

const periodLayout = "2006-01"

var (
	// ErrInvalidPeriod is a period that is not a YYYY-MM month.
	ErrInvalidPeriod = errors.New("period must be a month in YYYY-MM form")
	// ErrAlreadyClosed is a month that already has a statement.
	ErrAlreadyClosed = errors.New("the month is already closed")
	// ErrNotOver is a close of a month the tenant has not finished yet.
	ErrNotOver = errors.New("the month is not over yet")
	// ErrNotStarted is a preview of a month the tenant has not reached yet.
	ErrNotStarted = errors.New("the month has not started yet")
)

// ParsePeriod reads a YYYY-MM month as the first day of that month.
func ParsePeriod(raw string) (time.Time, error) {
	period, err := time.Parse(periodLayout, raw)
	if err != nil {
		return time.Time{}, ErrInvalidPeriod
	}
	return period, nil
}

// FormatPeriod writes a period back as YYYY-MM.
func FormatPeriod(period time.Time) string {
	return period.Format(periodLayout)
}

// Month is one tenant's calendar month. Period is the first day of the month
// at midnight UTC, as ParsePeriod returns it, and TimeZone is the tenant's
// resolved IANA zone the month is cut in.
type Month struct {
	TenantID uuid.UUID
	Period   time.Time
	TimeZone string
}

// bounds is the half-open range of instants the month covers.
func (m Month) bounds() (start, end time.Time, err error) {
	location, err := time.LoadLocation(m.TimeZone)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("load time zone %q: %w", m.TimeZone, err)
	}
	year, month, _ := m.Period.Date()
	start = time.Date(year, month, 1, 0, 0, 0, 0, location)
	return start, start.AddDate(0, 1, 0), nil
}

// TxBeginner is a *sql.DB for a caller that bypasses row-level security, or
// the request's tenant-scoped *sql.Conn for one that does not.
type TxBeginner interface {
	BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
}

// Totals are the month's own sales and what its lines pay out.
type Totals struct {
	Gross    int64
	Refunded int64
	Payout   int64
}

// Computation is a month computed from the sales as they stand.
type Computation struct {
	Totals Totals
	Lines  []dbmodels.ListRoyaltyLinesForPeriodRow
}

// PreviewStatement computes a month that is not closed, exactly as closing it
// at now would.
func PreviewStatement(ctx context.Context, db TxBeginner, month Month, now time.Time) (Computation, error) {
	start, _, err := month.bounds()
	if err != nil {
		return Computation{}, err
	}
	if now.Before(start) {
		return Computation{}, ErrNotStarted
	}

	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return Computation{}, err
	}
	defer tx.Rollback() //nolint:errcheck

	queries := dbmodels.New(tx)
	if _, err := queries.GetRoyaltyStatementByPeriod(ctx, dbmodels.GetRoyaltyStatementByPeriodParams{
		TenantID: month.TenantID,
		Period:   month.Period,
	}); err == nil {
		return Computation{}, ErrAlreadyClosed
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Computation{}, fmt.Errorf("read statement: %w", err)
	}

	computation, err := compute(ctx, queries, month)
	if err != nil {
		return Computation{}, err
	}
	return computation, tx.Commit()
}

// CloseStatement closes a month that is over into a statement and its lines,
// in one transaction. closedBy is the account that asked, or invalid for a
// close no user started. record runs in that transaction after the statement
// is written, so whatever it writes commits or rolls back with the close; nil
// records nothing.
//
// A month is closed once. A second close fails with ErrAlreadyClosed on the
// unique constraint rather than recomputing, which is also what settles a
// manual and an automatic close of the same month racing each other.
func CloseStatement(
	ctx context.Context,
	db TxBeginner,
	month Month,
	closedBy uuid.NullUUID,
	now time.Time,
	record func(ctx context.Context, queries *dbmodels.Queries, statement dbmodels.RoyaltyStatement) error,
) (dbmodels.RoyaltyStatement, error) {
	_, end, err := month.bounds()
	if err != nil {
		return dbmodels.RoyaltyStatement{}, err
	}
	if now.Before(end) {
		return dbmodels.RoyaltyStatement{}, ErrNotOver
	}

	// Repeatable read keeps the lines and the totals on one snapshot, so a
	// refund landing between the two reads cannot make them disagree.
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return dbmodels.RoyaltyStatement{}, err
	}
	defer tx.Rollback() //nolint:errcheck

	queries := dbmodels.New(tx)
	computation, err := compute(ctx, queries, month)
	if err != nil {
		return dbmodels.RoyaltyStatement{}, err
	}

	statement, err := queries.InsertRoyaltyStatement(ctx, dbmodels.InsertRoyaltyStatementParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       month.TenantID,
		Period:         month.Period,
		TimeZone:       month.TimeZone,
		ClosedByUserID: closedBy,
		TotalGross:     computation.Totals.Gross,
		TotalRefunded:  computation.Totals.Refunded,
		TotalPayout:    computation.Totals.Payout,
	})
	if err != nil {
		if dberr.UniqueViolationConstraint(err) == "royalty_statements_tenant_id_period_key" {
			return dbmodels.RoyaltyStatement{}, ErrAlreadyClosed
		}
		return dbmodels.RoyaltyStatement{}, fmt.Errorf("insert statement: %w", err)
	}

	if len(computation.Lines) > 0 {
		lines, err := statementLinesJSON(computation.Lines)
		if err != nil {
			return dbmodels.RoyaltyStatement{}, err
		}
		if err := queries.InsertRoyaltyStatementLines(ctx, dbmodels.InsertRoyaltyStatementLinesParams{
			TenantID:    month.TenantID,
			StatementID: statement.ID,
			Lines:       lines,
		}); err != nil {
			return dbmodels.RoyaltyStatement{}, fmt.Errorf("insert statement lines: %w", err)
		}
	}

	if record != nil {
		if err := record(ctx, queries, statement); err != nil {
			return dbmodels.RoyaltyStatement{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.RoyaltyStatement{}, err
	}
	return statement, nil
}

func compute(ctx context.Context, queries *dbmodels.Queries, month Month) (Computation, error) {
	lines, err := queries.ListRoyaltyLinesForPeriod(ctx, dbmodels.ListRoyaltyLinesForPeriodParams{
		TenantID: month.TenantID,
		Period:   month.Period,
		TimeZone: month.TimeZone,
	})
	if err != nil {
		return Computation{}, fmt.Errorf("compute statement lines: %w", err)
	}
	sales, err := queries.GetRoyaltySalesTotalsForPeriod(ctx, dbmodels.GetRoyaltySalesTotalsForPeriodParams{
		TenantID: month.TenantID,
		Period:   month.Period,
		TimeZone: month.TimeZone,
	})
	if err != nil {
		return Computation{}, fmt.Errorf("total sales: %w", err)
	}

	totals := Totals{Gross: sales.TotalGross, Refunded: sales.TotalRefunded}
	for _, line := range lines {
		totals.Payout += line.PayoutAmount
	}
	return Computation{Totals: totals, Lines: lines}, nil
}

// statementLine is one element of the JSON array InsertRoyaltyStatementLines
// reads, named after the columns it fills.
type statementLine struct {
	LineNumber     int32         `json:"line_number"`
	CreatorID      uuid.UUID     `json:"creator_id"`
	CreatorName    string        `json:"creator_name"`
	SeriesID       uuid.UUID     `json:"series_id"`
	SeriesTitle    string        `json:"series_title"`
	EpisodeID      uuid.UUID     `json:"episode_id"`
	EpisodeTitle   string        `json:"episode_title"`
	RoleID         uuid.NullUUID `json:"role_id"`
	RoleName       *string       `json:"role_name"`
	SaleCount      int32         `json:"sale_count"`
	GrossAmount    int64         `json:"gross_amount"`
	RefundedAmount int64         `json:"refunded_amount"`
	ShareBps       int32         `json:"share_bps"`
	PayoutAmount   int64         `json:"payout_amount"`
}

func statementLinesJSON(rows []dbmodels.ListRoyaltyLinesForPeriodRow) (json.RawMessage, error) {
	lines := make([]statementLine, 0, len(rows))
	for i, row := range rows {
		line := statementLine{
			LineNumber:     int32(i + 1),
			CreatorID:      row.CreatorID,
			CreatorName:    row.CreatorName,
			SeriesID:       row.SeriesID,
			SeriesTitle:    row.SeriesTitle,
			EpisodeID:      row.EpisodeID,
			EpisodeTitle:   row.EpisodeTitle,
			RoleID:         row.RoleID,
			SaleCount:      row.SaleCount,
			GrossAmount:    row.GrossAmount,
			RefundedAmount: row.RefundedAmount,
			ShareBps:       row.ShareBps,
			PayoutAmount:   row.PayoutAmount,
		}
		if row.RoleName.Valid {
			line.RoleName = &row.RoleName.String
		}
		lines = append(lines, line)
	}
	encoded, err := json.Marshal(lines)
	if err != nil {
		return nil, fmt.Errorf("encode statement lines: %w", err)
	}
	return encoded, nil
}
