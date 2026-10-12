// Package royalties closes a tenant month of sales into a royalty statement
// and previews a month that is not closed yet. The console's close RPC and the
// batch's automatic close both go through CloseStatement, so a month is closed
// by the same rules whoever closes it.
//
// A closed statement never changes. A refund recorded after the month of its
// sale was closed is carried into the next statement closed for a later month
// instead, as adjustment lines that take off the closed lines' payouts what
// the refunds take off their net. Each close writes down what it counted of
// every purchase, so a later close carries only the part of a refund that no
// statement has counted yet.
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
	"github.com/publira/publira/server/internal/paymentsettings"
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
// resolved IANA zone, which the month's own midnights are in.
type Month struct {
	TenantID uuid.UUID
	Period   time.Time
	TimeZone string
}

// Bounds is the half-open range of instants a month counts sales in.
type Bounds struct {
	Start time.Time
	End   time.Time
}

// bounds reads the range the month covers as the tenant's statements stand in
// the transaction: its own midnights in TimeZone, except where a closed month
// next to it already fixed the instant between the two.
func (m Month) bounds(ctx context.Context, queries *dbmodels.Queries) (Bounds, error) {
	row, err := queries.GetRoyaltyMonthBounds(ctx, dbmodels.GetRoyaltyMonthBoundsParams{
		TenantID: m.TenantID,
		Period:   m.Period,
		TimeZone: m.TimeZone,
	})
	if err != nil {
		return Bounds{}, fmt.Errorf("read month bounds: %w", err)
	}
	return Bounds{Start: row.StartsAt, End: row.EndsAt}, nil
}

// TxBeginner is a *sql.DB for a caller that bypasses row-level security, or
// the request's tenant-scoped *sql.Conn for one that does not.
type TxBeginner interface {
	BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
}

// Totals are the month's own sales, the net sales of earlier months it takes
// back, and what its lines pay out, its adjustment lines included.
type Totals struct {
	Gross      int64
	Refunded   int64
	Adjustment int64
	Payout     int64
}

// Computation is a month computed from the sales as they stand.
type Computation struct {
	Bounds Bounds
	// Currency is the one Totals and Lines are in, the tenant's, and the only
	// one whose sales they count.
	Currency string
	Totals   Totals
	Lines    []dbmodels.ListRoyaltyLinesForPeriodRow
	// Adjustments carry the refunds recorded since an earlier month was
	// closed on the sales its lines counted. A statement lists them after
	// Lines.
	Adjustments []dbmodels.ListRoyaltyAdjustmentLinesForPeriodRow
}

// PreviewStatement computes a month that is not closed, exactly as closing it
// at now would.
func PreviewStatement(ctx context.Context, db TxBeginner, month Month, now time.Time) (Computation, error) {
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

	bounds, err := month.bounds(ctx, queries)
	if err != nil {
		return Computation{}, err
	}
	if now.Before(bounds.Start) {
		return Computation{}, ErrNotStarted
	}

	computation, err := compute(ctx, queries, month, bounds)
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
//
// Two adjacent months closed at once are settled by the transaction's
// isolation instead. Each resolves its bounds before the other's statement is
// visible, so each would fall back to its own midnight, and the two midnights
// differ when the closes were made in different zones — an automatic close
// still on the old zone beside a manual one on the new. Serializable
// isolation makes PostgreSQL roll one of them back, and running it again
// reads the other's statement and starts or ends where it does.
func CloseStatement(
	ctx context.Context,
	db TxBeginner,
	month Month,
	closedBy uuid.NullUUID,
	now time.Time,
	record func(ctx context.Context, queries *dbmodels.Queries, statement dbmodels.RoyaltyStatement) error,
) (dbmodels.RoyaltyStatement, error) {
	for attempt := 1; ; attempt++ {
		statement, err := closeStatementOnce(ctx, db, month, closedBy, now, record)
		if !dberr.IsSerializationFailure(err) || attempt == maxCloseAttempts {
			return statement, err
		}
	}
}

// maxCloseAttempts bounds how often a close that keeps conflicting is run
// again. Only a close of an adjacent month, or of the same one, conflicts with
// it, so a second attempt already sees what the first could not.
const maxCloseAttempts = 3

func closeStatementOnce(
	ctx context.Context,
	db TxBeginner,
	month Month,
	closedBy uuid.NullUUID,
	now time.Time,
	record func(ctx context.Context, queries *dbmodels.Queries, statement dbmodels.RoyaltyStatement) error,
) (dbmodels.RoyaltyStatement, error) {
	// One snapshot keeps the bounds, the lines and the totals together, so a
	// refund landing between the reads cannot make them disagree.
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return dbmodels.RoyaltyStatement{}, err
	}
	defer tx.Rollback() //nolint:errcheck

	queries := dbmodels.New(tx)
	bounds, err := month.bounds(ctx, queries)
	if err != nil {
		return dbmodels.RoyaltyStatement{}, err
	}
	if now.Before(bounds.End) {
		return dbmodels.RoyaltyStatement{}, ErrNotOver
	}

	computation, err := compute(ctx, queries, month, bounds)
	if err != nil {
		return dbmodels.RoyaltyStatement{}, err
	}

	statement, err := queries.InsertRoyaltyStatement(ctx, dbmodels.InsertRoyaltyStatementParams{
		ID:              uuid.Must(uuid.NewV7()),
		TenantID:        month.TenantID,
		Period:          month.Period,
		TimeZone:        month.TimeZone,
		StartsAt:        bounds.Start,
		EndsAt:          bounds.End,
		ClosedByUserID:  closedBy,
		Currency:        computation.Currency,
		TotalGross:      computation.Totals.Gross,
		TotalRefunded:   computation.Totals.Refunded,
		TotalAdjustment: computation.Totals.Adjustment,
		TotalPayout:     computation.Totals.Payout,
	})
	if err != nil {
		if dberr.UniqueViolationConstraint(err) == "royalty_statements_tenant_id_period_key" {
			return dbmodels.RoyaltyStatement{}, ErrAlreadyClosed
		}
		return dbmodels.RoyaltyStatement{}, fmt.Errorf("insert statement: %w", err)
	}

	if len(computation.Lines)+len(computation.Adjustments) > 0 {
		lines, err := statementLinesJSON(computation.Lines, computation.Adjustments)
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
	// Written after the lines were computed, and read in the same snapshot, so
	// what the statement records having counted is what its lines counted.
	if err := queries.InsertRoyaltyStatementPurchases(ctx, dbmodels.InsertRoyaltyStatementPurchasesParams{
		StatementID: statement.ID,
		TenantID:    month.TenantID,
		Currency:    computation.Currency,
		StartsAt:    bounds.Start,
		EndsAt:      bounds.End,
		Period:      month.Period,
	}); err != nil {
		return dbmodels.RoyaltyStatement{}, fmt.Errorf("record counted purchases: %w", err)
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

func compute(ctx context.Context, queries *dbmodels.Queries, month Month, bounds Bounds) (Computation, error) {
	tenantID := month.TenantID
	// A statement is in the tenant currency, and a sale paid in another, by a
	// checkout started before the tenant changed it, is not one of its sales.
	currency, err := paymentsettings.TenantCurrency(ctx, queries, tenantID)
	if err != nil {
		return Computation{}, fmt.Errorf("resolve tenant currency: %w", err)
	}
	lines, err := queries.ListRoyaltyLinesForPeriod(ctx, dbmodels.ListRoyaltyLinesForPeriodParams{
		TenantID: tenantID,
		Currency: currency,
		StartsAt: bounds.Start,
		EndsAt:   bounds.End,
	})
	if err != nil {
		return Computation{}, fmt.Errorf("compute statement lines: %w", err)
	}
	sales, err := queries.GetRoyaltySalesTotalsForPeriod(ctx, dbmodels.GetRoyaltySalesTotalsForPeriodParams{
		TenantID: tenantID,
		Currency: currency,
		StartsAt: bounds.Start,
		EndsAt:   bounds.End,
	})
	if err != nil {
		return Computation{}, fmt.Errorf("total sales: %w", err)
	}
	// Only a statement of an earlier month carries its refunds forward, so a
	// month closed out of order leaves a later month's refunds to the next
	// close after that one.
	adjustments, err := queries.ListRoyaltyAdjustmentLinesForPeriod(ctx, dbmodels.ListRoyaltyAdjustmentLinesForPeriodParams{
		TenantID: tenantID,
		Currency: currency,
		Period:   month.Period,
	})
	if err != nil {
		return Computation{}, fmt.Errorf("compute adjustment lines: %w", err)
	}
	adjustment, err := queries.GetRoyaltyAdjustmentTotalForPeriod(ctx, dbmodels.GetRoyaltyAdjustmentTotalForPeriodParams{
		TenantID: tenantID,
		Currency: currency,
		Period:   month.Period,
	})
	if err != nil {
		return Computation{}, fmt.Errorf("total adjustment: %w", err)
	}

	totals := Totals{Gross: sales.TotalGross, Refunded: sales.TotalRefunded, Adjustment: adjustment}
	for _, line := range lines {
		totals.Payout += line.PayoutAmount
	}
	for _, line := range adjustments {
		totals.Payout += line.PayoutAmount
	}
	return Computation{Bounds: bounds, Currency: currency, Totals: totals, Lines: lines, Adjustments: adjustments}, nil
}

// statementLine is one element of the JSON array InsertRoyaltyStatementLines
// reads, named after the columns it fills.
type statementLine struct {
	LineNumber     int32         `json:"line_number"`
	CreatorID      uuid.NullUUID `json:"creator_id"`
	CreatorName    string        `json:"creator_name"`
	SeriesID       uuid.NullUUID `json:"series_id"`
	SeriesTitle    string        `json:"series_title"`
	EpisodeID      uuid.NullUUID `json:"episode_id"`
	EpisodeTitle   string        `json:"episode_title"`
	RoleID         uuid.NullUUID `json:"role_id"`
	RoleName       *string       `json:"role_name"`
	SaleCount      int32         `json:"sale_count"`
	GrossAmount    int64         `json:"gross_amount"`
	RefundedAmount int64         `json:"refunded_amount"`
	ShareBps       int32         `json:"share_bps"`
	PayoutAmount   int64         `json:"payout_amount"`
	// AdjustedStatementID and AdjustedLineNumber name the line an adjustment
	// adjusts, and are set on an adjustment line alone.
	AdjustedStatementID uuid.NullUUID `json:"adjusted_statement_id"`
	AdjustedLineNumber  *int32        `json:"adjusted_line_number"`
}

// statementLinesJSON numbers the month's own lines first and its adjustment
// lines after them.
func statementLinesJSON(rows []dbmodels.ListRoyaltyLinesForPeriodRow, adjustments []dbmodels.ListRoyaltyAdjustmentLinesForPeriodRow) (json.RawMessage, error) {
	lines := make([]statementLine, 0, len(rows)+len(adjustments))
	for i, row := range rows {
		line := statementLine{
			LineNumber:     int32(i + 1),
			CreatorID:      uuid.NullUUID{UUID: row.CreatorID, Valid: true},
			CreatorName:    row.CreatorName,
			SeriesID:       uuid.NullUUID{UUID: row.SeriesID, Valid: true},
			SeriesTitle:    row.SeriesTitle,
			EpisodeID:      uuid.NullUUID{UUID: row.EpisodeID, Valid: true},
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
	for _, row := range adjustments {
		line := statementLine{
			LineNumber:          int32(len(lines) + 1),
			CreatorID:           row.CreatorID,
			CreatorName:         row.CreatorName,
			SeriesID:            row.SeriesID,
			SeriesTitle:         row.SeriesTitle,
			EpisodeID:           row.EpisodeID,
			EpisodeTitle:        row.EpisodeTitle,
			RoleID:              row.RoleID,
			SaleCount:           row.SaleCount,
			GrossAmount:         row.GrossAmount,
			RefundedAmount:      row.RefundedAmount,
			ShareBps:            row.ShareBps,
			PayoutAmount:        row.PayoutAmount,
			AdjustedStatementID: uuid.NullUUID{UUID: row.AdjustedStatementID, Valid: true},
			AdjustedLineNumber:  &row.AdjustedLineNumber,
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
