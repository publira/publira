package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformconfig"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/readthrough"
	"github.com/publira/publira/server/internal/royalties"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenanttz"
)

const (
	defaultCreatorPagePageSize = int32(20)
	maxCreatorPagePageSize     = int32(100)

	// The order names the tokens of the creator pages' lists carry, each
	// followed by the creator the list is about, so a token from one creator's
	// page is refused on another's.
	creatorStatsListOrder          = "complete_count_desc"
	creatorStatementsListOrder     = "period_desc"
	creatorStatementLinesListOrder = "line_number_asc"
)

var (
	errCreatorPagesDisabled = errors.New("the tenant does not show its creators their pages")
	errCreatorSalesHidden   = errors.New("the tenant does not show its creators their sales")
)

func creatorPagesDisabledError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errCreatorPagesDisabled, rpcerrors.ReasonCreatorPagesDisabled)
}

func creatorSalesHiddenError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errCreatorSalesHidden, rpcerrors.ReasonCreatorSalesHidden)
}

func creatorNotFoundError() error {
	return connect.NewError(connect.CodeNotFound, "creator not found")
}

func invalidCreatorPageTokenError() error {
	return connect.NewError(connect.CodeInvalidArgument, "token is invalid")
}

// creatorPageReader is a request to a creator page from a signed-in reader the
// tenant shows those pages to.
type creatorPageReader struct {
	tenant       dbmodels.Tenant
	user         dbmodels.User
	surface      string
	salesVisible bool
	// staff is whether the account holds a staff role in the tenant. A link is
	// a reader's, as the console refuses to link a staff account, so an
	// account that became staff after it was linked reads as linked to none.
	staff bool
}

// creatorPageReaderOf signs the request's reader in and refuses it while the
// tenant shows its creators no pages. A tenant that has saved nothing shows
// none.
func (s *apiServer) creatorPageReaderOf(
	ctx context.Context,
	req interface {
		GetTenant() *publirattypesv1.TenantContext
		GetSurface() publirattypesv1.ClientSurface
	},
) (creatorPageReader, error) {
	tenant, user, role, err := s.currentUserFromSession(ctx, req.GetTenant(), rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return creatorPageReader{}, err
	}
	surface, err := callingSurface(req.GetSurface())
	if err != nil {
		return creatorPageReader{}, err
	}
	settings, err := s.queriesFor(ctx).GetTenantCreatorPages(ctx, tenant.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return creatorPageReader{}, s.internalDBError(ctx, "failed to read the tenant's creator pages settings", err, "tenant_id", tenant.ID.String())
	}
	if !settings.CreatorPagesEnabled {
		return creatorPageReader{}, creatorPagesDisabledError()
	}
	return creatorPageReader{
		tenant:       tenant,
		user:         user,
		surface:      surface,
		salesVisible: settings.CreatorPagesShowSales,
		staff:        auth.IsTenantStaff([]string{role}),
	}, nil
}

// requireSalesVisible refuses a read of the creator's money while the tenant
// does not show its creators their sales.
func (r creatorPageReader) requireSalesVisible() error {
	if !r.salesVisible {
		return creatorSalesHiddenError()
	}
	return nil
}

// linkedCreator resolves the creator a request names to one the reader is
// linked to, with the readers following it now. Any other creator is not_found
// whether or not it exists, so a page cannot be used to probe another Author.
func (s *apiServer) linkedCreator(ctx context.Context, reader creatorPageReader, raw string) (uuid.UUID, int64, error) {
	creatorID, err := requestRecordID("creator_id", raw)
	if err != nil {
		return uuid.Nil, 0, err
	}
	if reader.staff {
		return uuid.Nil, 0, creatorNotFoundError()
	}
	followers, err := s.queriesFor(ctx).GetMyCreatorFollowerCount(ctx, dbmodels.GetMyCreatorFollowerCountParams{
		TenantID:  reader.tenant.ID,
		UserID:    reader.user.ID,
		CreatorID: creatorID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, 0, creatorNotFoundError()
	}
	if err != nil {
		return uuid.Nil, 0, s.internalDBError(ctx, "failed to read the reader's creator", err,
			"tenant_id", reader.tenant.ID.String(), "user_id", reader.user.ID.String(), "creator_id", creatorID.String())
	}
	return creatorID, followers, nil
}

func (s *apiServer) ListMyCreators(
	ctx context.Context,
	req *publirav1.ListMyCreatorsRequest,
) (*publirav1.ListMyCreatorsResponse, error) {
	reader, err := s.creatorPageReaderOf(ctx, req)
	if err != nil {
		return nil, err
	}
	res := &publirav1.ListMyCreatorsResponse{
		Creators:     []*publirav1.MyCreator{},
		SalesVisible: reader.salesVisible,
	}
	if reader.staff {
		return noStorePrivateResponse(ctx, res), nil
	}

	rows, err := s.queriesFor(ctx).ListMyCreators(ctx, dbmodels.ListMyCreatorsParams{
		TenantID: reader.tenant.ID,
		UserID:   reader.user.ID,
		Surface:  reader.surface,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the reader's creators", err,
			"tenant_id", reader.tenant.ID.String(), "user_id", reader.user.ID.String())
	}
	var images protomapper.ImageOrigin
	imagesResolved := false
	for _, row := range rows {
		creator := &publirav1.MyCreator{
			Id:                   row.ID.String(),
			PublicId:             row.PublicID,
			Name:                 row.Name,
			PublishedSeriesCount: row.PublishedSeriesCount,
		}
		if row.IconImageID.Valid {
			if !imagesResolved {
				if images, err = s.imageOrigin(ctx, reader.tenant); err != nil {
					return nil, err
				}
				imagesResolved = true
			}
			creator.IconImageUrl = protomapper.CreatorIconURL(images, row.IconImageID.UUID)
		}
		res.Creators = append(res.Creators, creator)
	}
	return noStorePrivateResponse(ctx, res), nil
}

// creatorEpisodeStatsRow is one episode of a stats page, whichever way the
// page was scanned.
type creatorEpisodeStatsRow struct {
	episodeID uuid.UUID
	stats     *publirav1.MyCreatorEpisodeStats
}

func creatorEpisodeStatsRowOf(row dbmodels.ListMyCreatorEpisodeStatsDescRow) creatorEpisodeStatsRow {
	return creatorEpisodeStatsRow{
		episodeID: row.EpisodeID,
		stats: &publirav1.MyCreatorEpisodeStats{
			SeriesPublicId:  row.SeriesPublicID,
			SeriesTitle:     row.SeriesTitle,
			EpisodePublicId: row.EpisodePublicID,
			EpisodeTitle:    row.EpisodeTitle,
			MemberViewCount: row.MemberViewCount,
			CompleteCount:   row.CompleteCount,
		},
	}
}

func (s *apiServer) creatorEpisodeStatsPage(
	ctx context.Context,
	params dbmodels.ListMyCreatorEpisodeStatsDescParams,
	direction pagination.Direction,
) ([]creatorEpisodeStatsRow, error) {
	mapped := []creatorEpisodeStatsRow{}
	if direction == pagination.Backward {
		rows, err := s.queriesFor(ctx).ListMyCreatorEpisodeStatsAsc(ctx, dbmodels.ListMyCreatorEpisodeStatsAscParams(params))
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			mapped = append(mapped, creatorEpisodeStatsRowOf(dbmodels.ListMyCreatorEpisodeStatsDescRow(row)))
		}
		return mapped, nil
	}
	rows, err := s.queriesFor(ctx).ListMyCreatorEpisodeStatsDesc(ctx, params)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		mapped = append(mapped, creatorEpisodeStatsRowOf(row))
	}
	return mapped, nil
}

// GetMyCreatorStats answers how the creator's episodes were read over the
// window the console's read-through report covers, counted the same way, and,
// where the tenant shows sales, what each sold in it.
func (s *apiServer) GetMyCreatorStats(
	ctx context.Context,
	req *publirav1.GetMyCreatorStatsRequest,
) (*publirav1.GetMyCreatorStatsResponse, error) {
	reader, err := s.creatorPageReaderOf(ctx, req)
	if err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, reader.tenant)
	if err != nil {
		return nil, err
	}
	creatorID, followers, err := s.linkedCreator(ctx, reader, req.CreatorId)
	if err != nil {
		return nil, err
	}

	listKey := pagination.NewListKey(creatorStatsListOrder).Value("creator", creatorID.String())
	limit := pagination.NormalizeLimit(req.Limit, defaultCreatorPagePageSize, maxCreatorPagePageSize)
	cursor, err := decodeSurfaceToken(req.Token, reader.surface)
	if err != nil {
		return nil, invalidCreatorPageTokenError()
	}
	var keys pagination.CountUUIDKeys
	if !cursor.IsZero() {
		keys, err = listKey.DecodeCountUUID(cursor)
		if err != nil {
			return nil, invalidCreatorPageTokenError()
		}
	}

	queries := s.queriesFor(ctx)
	timeZone := tenanttz.Resolve(reader.tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries))
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		// A stored zone nothing can load leaves no honest day to count in, as
		// in the console's report.
		return nil, s.internalError(ctx, "failed to load the tenant time zone", err,
			"tenant_id", reader.tenant.ID.String(), "time_zone", timeZone)
	}
	period := readthrough.Resolve(time.Now(), location)
	currency, err := s.tenantCurrency(ctx, queries, reader.tenant.ID)
	if err != nil {
		return nil, err
	}

	totals, err := queries.GetMyCreatorEpisodeStatsTotals(ctx, dbmodels.GetMyCreatorEpisodeStatsTotalsParams{
		TenantID:    reader.tenant.ID,
		UserID:      reader.user.ID,
		CreatorID:   creatorID,
		Surface:     reader.surface,
		PeriodStart: period.Start,
		PeriodEnd:   period.End,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to total the creator's read-through", err,
			"tenant_id", reader.tenant.ID.String(), "creator_id", creatorID.String())
	}

	rows, err := s.creatorEpisodeStatsPage(ctx, dbmodels.ListMyCreatorEpisodeStatsDescParams{
		TenantID:            reader.tenant.ID,
		UserID:              reader.user.ID,
		CreatorID:           creatorID,
		Surface:             reader.surface,
		Locale:              readerLocale,
		PeriodStart:         period.Start,
		PeriodEnd:           period.End,
		CursorEpisodeID:     uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorCompleteCount: sql.NullInt64{Int64: keys.Count, Valid: keys.Valid},
		CursorInclusive:     keys.Inclusive,
		Limit:               limit + 1,
	}, cursor.Direction)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the creator's episode stats", err,
			"tenant_id", reader.tenant.ID.String(), "creator_id", creatorID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	if reader.salesVisible && len(rows) > 0 {
		if err := s.setCreatorEpisodeSales(ctx, reader, rows, period, timeZone, currency); err != nil {
			return nil, err
		}
	}

	res := &publirav1.GetMyCreatorStatsResponse{
		PeriodStart:          period.Start.Format(time.DateOnly),
		PeriodEnd:            period.End.Format(time.DateOnly),
		TimeZone:             timeZone,
		FollowerCount:        followers,
		TotalMemberViewCount: totals.MemberViewCount,
		TotalCompleteCount:   totals.CompleteCount,
		Currency:             currency,
		Episodes:             make([]*publirav1.MyCreatorEpisodeStats, 0, len(rows)),
	}
	for _, row := range rows {
		res.Episodes = append(res.Episodes, row.stats)
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.EncodeCountUUID(pagination.Backward, rows[0].stats.CompleteCount, rows[0].episodeID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = listKey.EncodeCountUUID(pagination.Forward, last.stats.CompleteCount, last.episodeID)
		}
	// An empty page means the boundary row moved: a re-aggregation changes an
	// episode's completions, and the window slides daily. Recover once, as
	// the console's report does.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeCountUUIDRecovery(pagination.Backward, keys.Count, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = listKey.EncodeCountUUIDRecovery(pagination.Forward, keys.Count, keys.ID)
	}
	bindSurfaceTokens(reader.surface, &res.PreviousToken, &res.NextToken)
	return noStorePrivateResponse(ctx, res), nil
}

// setCreatorEpisodeSales puts what each episode of the page sold in the window
// onto it. An episode that sold nothing carries zeros, so a set field always
// means the tenant shows sales.
func (s *apiServer) setCreatorEpisodeSales(
	ctx context.Context,
	reader creatorPageReader,
	rows []creatorEpisodeStatsRow,
	period readthrough.Period,
	timeZone, currency string,
) error {
	episodeIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		episodeIDs = append(episodeIDs, row.episodeID)
	}
	sales, err := s.queriesFor(ctx).ListMyCreatorEpisodeSales(ctx, dbmodels.ListMyCreatorEpisodeSalesParams{
		TenantID:   reader.tenant.ID,
		EpisodeIds: episodeIDs,
		Currency:   currency,
		TimeZone:   timeZone,
		StartDate:  period.Start,
		EndDate:    period.End,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to read the creator's episode sales", err, "tenant_id", reader.tenant.ID.String())
	}
	byEpisode := make(map[uuid.UUID]dbmodels.ListMyCreatorEpisodeSalesRow, len(sales))
	for _, sale := range sales {
		byEpisode[sale.EpisodeID] = sale
	}
	for _, row := range rows {
		sale := byEpisode[row.episodeID]
		purchaseCount := sale.PurchaseCount
		netAmount := sale.GrossAmount - sale.RefundedAmount
		row.stats.PurchaseCount = &purchaseCount
		row.stats.NetAmount = &netAmount
	}
	return nil
}

func myCreatorStatementOf(row dbmodels.ListMyCreatorStatementsDescRow) *publirav1.MyCreatorStatement {
	return &publirav1.MyCreatorStatement{
		Period:         royalties.FormatPeriod(row.Period),
		TimeZone:       row.TimeZone,
		ClosedAt:       row.ClosedAt.UTC().Format(time.RFC3339),
		Currency:       row.Currency,
		SaleCount:      row.SaleCount,
		GrossAmount:    row.GrossAmount,
		RefundedAmount: row.RefundedAmount,
		PayoutAmount:   row.PayoutAmount,
	}
}

// ListMyCreatorStatements lists every closed month with the creator's part of
// it, newest first. A statement is never deleted while its tenant exists, so a
// boundary row cannot disappear and the list issues no recovery token.
func (s *apiServer) ListMyCreatorStatements(
	ctx context.Context,
	req *publirav1.ListMyCreatorStatementsRequest,
) (*publirav1.ListMyCreatorStatementsResponse, error) {
	reader, err := s.creatorPageReaderOf(ctx, req)
	if err != nil {
		return nil, err
	}
	if err := reader.requireSalesVisible(); err != nil {
		return nil, err
	}
	creatorID, _, err := s.linkedCreator(ctx, reader, req.CreatorId)
	if err != nil {
		return nil, err
	}

	listKey := pagination.NewListKey(creatorStatementsListOrder).Value("creator", creatorID.String())
	limit := pagination.NormalizeLimit(req.Limit, defaultCreatorPagePageSize, maxCreatorPagePageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, invalidCreatorPageTokenError()
	}
	var cursorPeriod time.Time
	if !cursor.IsZero() {
		if cursor, err = listKey.Decode(cursor); err != nil || len(cursor.Keys) != 1 {
			return nil, invalidCreatorPageTokenError()
		}
		if cursorPeriod, err = royalties.ParsePeriod(cursor.Keys[0]); err != nil {
			return nil, invalidCreatorPageTokenError()
		}
	}

	queries := s.queriesFor(ctx)
	var rows []dbmodels.ListMyCreatorStatementsDescRow
	if cursor.Direction == pagination.Backward {
		ascending, err := queries.ListMyCreatorStatementsAsc(ctx, dbmodels.ListMyCreatorStatementsAscParams{
			TenantID:     reader.tenant.ID,
			UserID:       reader.user.ID,
			CreatorID:    creatorID,
			CursorPeriod: cursorPeriod,
			RowLimit:     limit + 1,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list the creator's statements", err,
				"tenant_id", reader.tenant.ID.String(), "creator_id", creatorID.String())
		}
		for _, row := range ascending {
			rows = append(rows, dbmodels.ListMyCreatorStatementsDescRow(row))
		}
	} else {
		rows, err = queries.ListMyCreatorStatementsDesc(ctx, dbmodels.ListMyCreatorStatementsDescParams{
			TenantID:     reader.tenant.ID,
			UserID:       reader.user.ID,
			CreatorID:    creatorID,
			HasCursor:    !cursor.IsZero(),
			CursorPeriod: cursorPeriod,
			RowLimit:     limit + 1,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list the creator's statements", err,
				"tenant_id", reader.tenant.ID.String(), "creator_id", creatorID.String())
		}
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	res := &publirav1.ListMyCreatorStatementsResponse{
		Statements: make([]*publirav1.MyCreatorStatement, 0, len(rows)),
	}
	for _, row := range rows {
		res.Statements = append(res.Statements, myCreatorStatementOf(row))
	}
	if len(rows) > 0 {
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.Encode(pagination.Backward, royalties.FormatPeriod(rows[0].Period))
		}
		if hasNext {
			res.NextToken = listKey.Encode(pagination.Forward, royalties.FormatPeriod(rows[len(rows)-1].Period))
		}
	}
	return noStorePrivateResponse(ctx, res), nil
}

func myCreatorStatementLineOf(row dbmodels.ListMyCreatorStatementLinesAscRow) *publirav1.MyCreatorStatementLine {
	line := &publirav1.MyCreatorStatementLine{
		LineNumber:      row.LineNumber,
		SeriesPublicId:  row.SeriesPublicID.String,
		SeriesTitle:     row.SeriesTitle,
		EpisodePublicId: row.EpisodePublicID.String,
		EpisodeTitle:    row.EpisodeTitle,
		RoleName:        row.RoleName.String,
		SaleCount:       row.SaleCount,
		GrossAmount:     row.GrossAmount,
		RefundedAmount:  row.RefundedAmount,
		ShareBps:        row.ShareBps,
		PayoutAmount:    row.PayoutAmount,
		Source:          publirav1.CreatorStatementLineSource_CREATOR_STATEMENT_LINE_SOURCE_SALE,
	}
	if row.AdjustedPeriod.Valid {
		line.AdjustedPeriod = royalties.FormatPeriod(row.AdjustedPeriod.Time)
	}
	if royalties.LineSource(row.Source) == royalties.SourceSubscription {
		line.Source = publirav1.CreatorStatementLineSource_CREATOR_STATEMENT_LINE_SOURCE_SUBSCRIPTION
	}
	return line
}

// GetMyCreatorStatement answers the creator's part of one closed month and a
// page of the creator's own lines of it. Lines are never deleted, so no
// recovery token is issued, as in ListMyCreatorStatements.
func (s *apiServer) GetMyCreatorStatement(
	ctx context.Context,
	req *publirav1.GetMyCreatorStatementRequest,
) (*publirav1.GetMyCreatorStatementResponse, error) {
	reader, err := s.creatorPageReaderOf(ctx, req)
	if err != nil {
		return nil, err
	}
	if err := reader.requireSalesVisible(); err != nil {
		return nil, err
	}
	creatorID, _, err := s.linkedCreator(ctx, reader, req.CreatorId)
	if err != nil {
		return nil, err
	}
	period, err := royalties.ParsePeriod(req.Period)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "period")
	}
	periodKey := royalties.FormatPeriod(period)

	listKey := pagination.NewListKey(creatorStatementLinesListOrder).
		Value("creator", creatorID.String()).
		Value("period", periodKey)
	limit := pagination.NormalizeLimit(req.Limit, defaultCreatorPagePageSize, maxCreatorPagePageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, invalidCreatorPageTokenError()
	}
	var cursorLine int32
	if !cursor.IsZero() {
		if cursor, err = listKey.Decode(cursor); err != nil || len(cursor.Keys) != 1 {
			return nil, invalidCreatorPageTokenError()
		}
		parsed, err := strconv.ParseInt(cursor.Keys[0], 10, 32)
		if err != nil || parsed < 0 {
			return nil, invalidCreatorPageTokenError()
		}
		cursorLine = int32(parsed)
	}

	queries := s.queriesFor(ctx)
	header, err := queries.GetMyCreatorStatement(ctx, dbmodels.GetMyCreatorStatementParams{
		TenantID:  reader.tenant.ID,
		UserID:    reader.user.ID,
		CreatorID: creatorID,
		Period:    period,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeNotFound, "royalty statement not found")
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get the creator's statement", err,
			"tenant_id", reader.tenant.ID.String(), "creator_id", creatorID.String(), "period", periodKey)
	}

	var rows []dbmodels.ListMyCreatorStatementLinesAscRow
	if cursor.Direction == pagination.Backward {
		descending, err := queries.ListMyCreatorStatementLinesDesc(ctx, dbmodels.ListMyCreatorStatementLinesDescParams{
			TenantID:         reader.tenant.ID,
			StatementID:      header.ID,
			UserID:           reader.user.ID,
			CreatorID:        creatorID,
			BeforeLineNumber: cursorLine,
			RowLimit:         limit + 1,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list the creator's statement lines", err,
				"tenant_id", reader.tenant.ID.String(), "creator_id", creatorID.String(), "period", periodKey)
		}
		for _, row := range descending {
			rows = append(rows, dbmodels.ListMyCreatorStatementLinesAscRow(row))
		}
	} else {
		rows, err = queries.ListMyCreatorStatementLinesAsc(ctx, dbmodels.ListMyCreatorStatementLinesAscParams{
			TenantID:        reader.tenant.ID,
			StatementID:     header.ID,
			UserID:          reader.user.ID,
			CreatorID:       creatorID,
			AfterLineNumber: cursorLine,
			RowLimit:        limit + 1,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list the creator's statement lines", err,
				"tenant_id", reader.tenant.ID.String(), "creator_id", creatorID.String(), "period", periodKey)
		}
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	res := &publirav1.GetMyCreatorStatementResponse{
		Statement: myCreatorStatementOf(dbmodels.ListMyCreatorStatementsDescRow{
			Period:         header.Period,
			TimeZone:       header.TimeZone,
			ClosedAt:       header.ClosedAt,
			Currency:       header.Currency,
			SaleCount:      header.SaleCount,
			GrossAmount:    header.GrossAmount,
			RefundedAmount: header.RefundedAmount,
			PayoutAmount:   header.PayoutAmount,
		}),
		Lines: make([]*publirav1.MyCreatorStatementLine, 0, len(rows)),
	}
	for _, row := range rows {
		res.Lines = append(res.Lines, myCreatorStatementLineOf(row))
	}
	if len(rows) > 0 {
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.Encode(pagination.Backward, strconv.Itoa(int(rows[0].LineNumber)))
		}
		if hasNext {
			res.NextToken = listKey.Encode(pagination.Forward, strconv.Itoa(int(rows[len(rows)-1].LineNumber)))
		}
	}
	return noStorePrivateResponse(ctx, res), nil
}
