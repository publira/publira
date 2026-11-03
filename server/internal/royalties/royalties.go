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
//
// A month also shares the subscription payments whose period ends in it,
// each among the episodes of its plan the subscriber finished in that period,
// as subscription lines beside the lines of sales. The close writes down the
// parts it shared each payment by, so a refund of one recorded later is
// carried back from the same episodes.
//
// A statement states the tax its payouts include and what is withheld from
// each Author. Each purchase and payment records the tenant's tax rate when it
// was made, a line counts the sales of one rate, and its tax is worked out
// from its payout at that rate. The tenant's withholding rate at close is
// applied to each Author's subtotal, and kept on the statement as its time
// zone is.
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

// Totals are the month's own sales and the subscription payments it shares,
// the net of earlier months it takes back, and what its lines pay out, its
// adjustment lines included. Tax is what the payouts include, invalid where
// no line has a rate, and Withholding what the subtotals withhold, invalid
// where the month withholds nothing.
type Totals struct {
	Gross       int64
	Refunded    int64
	Adjustment  int64
	Payout      int64
	Tax         sql.NullInt64
	Withholding sql.NullInt64
}

// CreatorSubtotal is what a statement pays one Author: the payouts of the
// lines crediting them added up, the tax those include, and what is withheld.
type CreatorSubtotal struct {
	// CreatorID is invalid for the adjustments of lines closed before lines
	// kept their creator's ID, which are added up together.
	CreatorID uuid.NullUUID
	// CreatorPublicID is empty once the creator has been deleted.
	CreatorPublicID string
	// CreatorName is the name on the Author's first line.
	CreatorName string
	Payout      int64
	// Tax is invalid where none of the Author's lines has a rate.
	Tax sql.NullInt64
	// Withholding is invalid where the month withholds nothing.
	Withholding sql.NullInt64
}

// TaxIncluded is the tax a tax-inclusive amount includes at a rate in basis
// points: the amount less the amount without tax, rounded down. Go's integer
// division truncates toward zero as PostgreSQL's does, so this is
// tax_included() in the schema, and a negative amount includes the negation of
// what its absolute value would.
func TaxIncluded(amount int64, rateBps int32) int64 {
	return amount - amount*10000/(10000+int64(rateBps))
}

// LineTax is the tax a line's payout includes at the line's rate, invalid
// where the line has none.
func LineTax(rateBps sql.NullInt32, payout int64) sql.NullInt64 {
	if !rateBps.Valid {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: TaxIncluded(payout, rateBps.Int32), Valid: true}
}

// AdjustmentTax is the tax an adjustment takes off the line it adjusts, at
// that line's rate: the tax of what the line pays after the adjustment, its
// own payout and every adjustment so far added up, less the tax of what it
// paid before. Worked out on each adjustment's payout alone, the taxes of a
// line refunded over several months would not add up to the tax of what it
// still pays: a payout of 1,100 at 10% includes 100, and adjustments of -1 and
// -1,099 would take 1 and 100 off it. Invalid where the line has no rate.
func AdjustmentTax(rateBps sql.NullInt32, countedPayout, payout int64) sql.NullInt64 {
	if !rateBps.Valid {
		return sql.NullInt64{}
	}
	return sql.NullInt64{
		Int64: TaxIncluded(countedPayout+payout, rateBps.Int32) - TaxIncluded(countedPayout, rateBps.Int32),
		Valid: true,
	}
}

// Withholding is what a withholding rate in basis points takes from a payout
// less the tax it includes, rounded down, and nothing from a payout that is
// not above its tax. Invalid where there is no rate.
func Withholding(rateBps sql.NullInt32, payout int64, tax sql.NullInt64) sql.NullInt64 {
	if !rateBps.Valid {
		return sql.NullInt64{}
	}
	base := payout - tax.Int64
	if base <= 0 {
		return sql.NullInt64{Int64: 0, Valid: true}
	}
	return sql.NullInt64{Int64: base * int64(rateBps.Int32) / 10000, Valid: true}
}

// Computation is a month computed from the sales as they stand.
type Computation struct {
	Bounds Bounds
	// Currency is the one Totals and Lines are in, the tenant's, and the only
	// one whose sales they count.
	Currency string
	Totals   Totals
	// Lines are the month's own lines of sales, then its lines of tips.
	Lines []dbmodels.ListRoyaltyLinesForPeriodRow
	// SubscriptionLines share the month's subscription payments. A statement
	// lists them after Lines.
	SubscriptionLines []dbmodels.ListRoyaltySubscriptionLinesForPeriodRow
	// Adjustments carry the refunds recorded since an earlier month was
	// closed on the sales and the payments its lines counted. A statement
	// lists them after SubscriptionLines.
	Adjustments []dbmodels.ListRoyaltyAdjustmentLinesForPeriodRow
	// WithholdingRate is the tenant's, which a close records on the
	// statement. Invalid withholds nothing.
	WithholdingRate sql.NullInt32
	// Subtotals are what each Author is paid, in the order of their first
	// line.
	Subtotals []CreatorSubtotal
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
		ID:                 uuid.Must(uuid.NewV7()),
		TenantID:           month.TenantID,
		Period:             month.Period,
		TimeZone:           month.TimeZone,
		StartsAt:           bounds.Start,
		EndsAt:             bounds.End,
		ClosedByUserID:     closedBy,
		Currency:           computation.Currency,
		TotalGross:         computation.Totals.Gross,
		TotalRefunded:      computation.Totals.Refunded,
		TotalAdjustment:    computation.Totals.Adjustment,
		TotalPayout:        computation.Totals.Payout,
		WithholdingRateBps: computation.WithholdingRate,
		TotalTax:           computation.Totals.Tax,
		TotalWithholding:   computation.Totals.Withholding,
	})
	if err != nil {
		if dberr.UniqueViolationConstraint(err) == "royalty_statements_tenant_id_period_key" {
			return dbmodels.RoyaltyStatement{}, ErrAlreadyClosed
		}
		return dbmodels.RoyaltyStatement{}, fmt.Errorf("insert statement: %w", err)
	}

	if len(computation.Lines)+len(computation.SubscriptionLines)+len(computation.Adjustments) > 0 {
		lines, err := statementLinesJSON(computation)
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
	if len(computation.Subtotals) > 0 {
		subtotals, err := creatorSubtotalsJSON(computation.Subtotals)
		if err != nil {
			return dbmodels.RoyaltyStatement{}, err
		}
		if err := queries.InsertRoyaltyStatementCreatorSubtotals(ctx, dbmodels.InsertRoyaltyStatementCreatorSubtotalsParams{
			TenantID:    month.TenantID,
			StatementID: statement.ID,
			Subtotals:   subtotals,
		}); err != nil {
			return dbmodels.RoyaltyStatement{}, fmt.Errorf("insert creator subtotals: %w", err)
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
	if err := queries.InsertRoyaltyStatementSubscriptionParts(ctx, dbmodels.InsertRoyaltyStatementSubscriptionPartsParams{
		StatementID: statement.ID,
		TenantID:    month.TenantID,
		Currency:    computation.Currency,
		StartsAt:    bounds.Start,
		EndsAt:      bounds.End,
	}); err != nil {
		return dbmodels.RoyaltyStatement{}, fmt.Errorf("record shared subscription parts: %w", err)
	}
	if err := queries.InsertRoyaltyStatementSubscriptionPayments(ctx, dbmodels.InsertRoyaltyStatementSubscriptionPaymentsParams{
		StatementID: statement.ID,
		TenantID:    month.TenantID,
		Currency:    computation.Currency,
		StartsAt:    bounds.Start,
		EndsAt:      bounds.End,
		Period:      month.Period,
	}); err != nil {
		return dbmodels.RoyaltyStatement{}, fmt.Errorf("record counted subscription payments: %w", err)
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
	subscriptionLines, err := queries.ListRoyaltySubscriptionLinesForPeriod(ctx, dbmodels.ListRoyaltySubscriptionLinesForPeriodParams{
		TenantID: tenantID,
		Currency: currency,
		StartsAt: bounds.Start,
		EndsAt:   bounds.End,
	})
	if err != nil {
		return Computation{}, fmt.Errorf("compute subscription lines: %w", err)
	}
	subscriptions, err := queries.GetRoyaltySubscriptionTotalsForPeriod(ctx, dbmodels.GetRoyaltySubscriptionTotalsForPeriodParams{
		TenantID: tenantID,
		Currency: currency,
		StartsAt: bounds.Start,
		EndsAt:   bounds.End,
	})
	if err != nil {
		return Computation{}, fmt.Errorf("total subscription payments: %w", err)
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

	withholdingRate, err := queries.GetTenantWithholdingRate(ctx, tenantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Computation{}, fmt.Errorf("read withholding rate: %w", err)
	}

	computation := Computation{
		Bounds:            bounds,
		Currency:          currency,
		Lines:             lines,
		SubscriptionLines: subscriptionLines,
		Adjustments:       adjustments,
		WithholdingRate:   withholdingRate,
		Totals: Totals{
			Gross:      sales.TotalGross + subscriptions.TotalGross,
			Refunded:   sales.TotalRefunded + subscriptions.TotalRefunded,
			Adjustment: adjustment,
		},
	}
	computation.Subtotals = subtotalsOf(computation)
	for _, subtotal := range computation.Subtotals {
		computation.Totals.Payout += subtotal.Payout
		if subtotal.Tax.Valid {
			computation.Totals.Tax.Int64 += subtotal.Tax.Int64
			computation.Totals.Tax.Valid = true
		}
		if subtotal.Withholding.Valid {
			computation.Totals.Withholding.Int64 += subtotal.Withholding.Int64
		}
	}
	computation.Totals.Withholding.Valid = withholdingRate.Valid
	return computation, nil
}

// creditedLine is what a subtotal reads of a line of any kind.
type creditedLine struct {
	creatorID       uuid.NullUUID
	creatorPublicID string
	creatorName     string
	payout          int64
	tax             sql.NullInt64
}

// creditedLines lists every line of a computation in the order a statement
// numbers them.
func creditedLines(computation Computation) []creditedLine {
	lines := make([]creditedLine, 0, len(computation.Lines)+len(computation.SubscriptionLines)+len(computation.Adjustments))
	for _, row := range computation.Lines {
		lines = append(lines, creditedLine{
			creatorID:       uuid.NullUUID{UUID: row.CreatorID, Valid: true},
			creatorPublicID: row.CreatorPublicID,
			creatorName:     row.CreatorName,
			payout:          row.PayoutAmount,
			tax:             LineTax(row.TaxRateBps, row.PayoutAmount),
		})
	}
	for _, row := range computation.SubscriptionLines {
		lines = append(lines, creditedLine{
			creatorID:       uuid.NullUUID{UUID: row.CreatorID, Valid: true},
			creatorPublicID: row.CreatorPublicID,
			creatorName:     row.CreatorName,
			payout:          row.PayoutAmount,
			tax:             LineTax(row.TaxRateBps, row.PayoutAmount),
		})
	}
	for _, row := range computation.Adjustments {
		lines = append(lines, creditedLine{
			creatorID:       row.CreatorID,
			creatorPublicID: row.CreatorPublicID.String,
			creatorName:     row.CreatorName,
			payout:          row.PayoutAmount,
			tax:             AdjustmentTax(row.TaxRateBps, row.CountedPayoutAmount, row.PayoutAmount),
		})
	}
	return lines
}

// subtotalsOf adds a computation's lines up by creator, in the order of each
// creator's first line, and withholds the tenant's rate from each.
func subtotalsOf(computation Computation) []CreatorSubtotal {
	var subtotals []CreatorSubtotal
	index := make(map[uuid.NullUUID]int)
	for _, line := range creditedLines(computation) {
		i, ok := index[line.creatorID]
		if !ok {
			i = len(subtotals)
			index[line.creatorID] = i
			subtotals = append(subtotals, CreatorSubtotal{
				CreatorID:       line.creatorID,
				CreatorPublicID: line.creatorPublicID,
				CreatorName:     line.creatorName,
			})
		}
		subtotals[i].Payout += line.payout
		if line.tax.Valid {
			subtotals[i].Tax.Int64 += line.tax.Int64
			subtotals[i].Tax.Valid = true
		}
	}
	for i := range subtotals {
		subtotals[i].Withholding = Withholding(computation.WithholdingRate, subtotals[i].Payout, subtotals[i].Tax)
	}
	return subtotals
}

// creatorSubtotal is one element of the JSON array
// InsertRoyaltyStatementCreatorSubtotals reads, named after the columns it
// fills.
type creatorSubtotal struct {
	Position          int32         `json:"position"`
	CreatorID         uuid.NullUUID `json:"creator_id"`
	CreatorName       string        `json:"creator_name"`
	PayoutAmount      int64         `json:"payout_amount"`
	TaxAmount         *int64        `json:"tax_amount"`
	WithholdingAmount *int64        `json:"withholding_amount"`
}

func creatorSubtotalsJSON(subtotals []CreatorSubtotal) (json.RawMessage, error) {
	rows := make([]creatorSubtotal, 0, len(subtotals))
	for i, subtotal := range subtotals {
		row := creatorSubtotal{
			Position:     int32(i + 1),
			CreatorID:    subtotal.CreatorID,
			CreatorName:  subtotal.CreatorName,
			PayoutAmount: subtotal.Payout,
		}
		if subtotal.Tax.Valid {
			row.TaxAmount = &subtotal.Tax.Int64
		}
		if subtotal.Withholding.Valid {
			row.WithholdingAmount = &subtotal.Withholding.Int64
		}
		rows = append(rows, row)
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		return nil, fmt.Errorf("encode creator subtotals: %w", err)
	}
	return encoded, nil
}

// Source is what a statement line credits, spelled as
// royalty_statement_lines.source stores it.
type Source string

const (
	// SourceSale is the sales of an episode, and what a line closed before
	// lines had a source credits.
	SourceSale Source = "sale"
	// SourceSubscription is the parts of subscription payments shared to an
	// episode.
	SourceSubscription Source = "subscription"
	// SourceTip is the tips readers gave the Authors of an episode.
	SourceTip Source = "tip"
)

// LineSource reads the source a stored line records, which is empty on a line
// closed before lines had one.
func LineSource(stored sql.NullString) Source {
	if !stored.Valid {
		return SourceSale
	}
	return Source(stored.String)
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
	Source              Source        `json:"source"`
	TaxRateBps          *int32        `json:"tax_rate_bps"`
	TaxAmount           *int64        `json:"tax_amount"`
}

// withTax sets the line's rate and its tax, and leaves both NULL for a line
// without a rate.
func (line statementLine) withTax(rateBps sql.NullInt32, tax sql.NullInt64) statementLine {
	if rateBps.Valid && tax.Valid {
		rate, amount := rateBps.Int32, tax.Int64
		line.TaxRateBps = &rate
		line.TaxAmount = &amount
	}
	return line
}

// statementLinesJSON numbers the month's own lines of sales first, its lines of
// tips and then its subscription lines after them, and its adjustment lines
// last.
func statementLinesJSON(computation Computation) (json.RawMessage, error) {
	lines := make([]statementLine, 0, len(computation.Lines)+len(computation.SubscriptionLines)+len(computation.Adjustments))
	for _, row := range computation.Lines {
		line := statementLine{
			LineNumber:     int32(len(lines) + 1),
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
			Source:         Source(row.Source),
		}.withTax(row.TaxRateBps, LineTax(row.TaxRateBps, row.PayoutAmount))
		if row.RoleName.Valid {
			line.RoleName = &row.RoleName.String
		}
		lines = append(lines, line)
	}
	for _, row := range computation.SubscriptionLines {
		line := statementLine{
			LineNumber:     int32(len(lines) + 1),
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
			Source:         SourceSubscription,
		}.withTax(row.TaxRateBps, LineTax(row.TaxRateBps, row.PayoutAmount))
		if row.RoleName.Valid {
			line.RoleName = &row.RoleName.String
		}
		lines = append(lines, line)
	}
	for _, row := range computation.Adjustments {
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
			Source:              Source(row.Source),
		}.withTax(row.TaxRateBps, AdjustmentTax(row.TaxRateBps, row.CountedPayoutAmount, row.PayoutAmount))
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
