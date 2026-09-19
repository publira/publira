package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/royalties"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenanttz"
)

const (
	defaultRoyaltyPageSize = 20
	maxRoyaltyPageSize     = 100
	royaltyCloseModeManual = "manual"
	royaltyCloseModeAuto   = "automatic"
)

func royaltyConfigToProto(config dbmodels.TenantRoyaltyConfig) *publiraadminv1.RoyaltyConfig {
	result := &publiraadminv1.RoyaltyConfig{
		CloseMode: royaltyCloseModeToProto(config.CloseMode),
	}
	if config.AutoCloseDay.Valid {
		day := config.AutoCloseDay.Int32
		result.AutoCloseDay = &day
	}
	if config.AutomaticSince.Valid {
		result.AutomaticSince = config.AutomaticSince.Time.Format(time.RFC3339)
	}
	return result
}

func royaltyCloseModeToProto(mode string) publiraadminv1.RoyaltyCloseMode {
	if mode == royaltyCloseModeAuto {
		return publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_AUTOMATIC
	}
	return publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_MANUAL
}

func royaltyCloseModeFromProto(mode publiraadminv1.RoyaltyCloseMode) (string, error) {
	switch mode {
	case publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_MANUAL:
		return royaltyCloseModeManual, nil
	case publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_AUTOMATIC:
		return royaltyCloseModeAuto, nil
	default:
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("close_mode must be manual or automatic"))
	}
}

// GetRoyaltyConfig returns manual for tenants that have not chosen a policy.
func (s *adminServer) GetRoyaltyConfig(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetRoyaltyConfigRequest],
) (*connect.Response[publiraadminv1.GetRoyaltyConfigResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantRoyaltyConfigByTenantID(ctx, tenant.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return connect.NewResponse(&publiraadminv1.GetRoyaltyConfigResponse{
			Config: &publiraadminv1.RoyaltyConfig{CloseMode: publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_MANUAL},
		}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get royalty config", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetRoyaltyConfigResponse{Config: royaltyConfigToProto(config)}), nil
}

func (s *adminServer) UpdateRoyaltyConfig(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateRoyaltyConfigRequest],
) (*connect.Response[publiraadminv1.UpdateRoyaltyConfigResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	closeMode, err := royaltyCloseModeFromProto(req.Msg.CloseMode)
	if err != nil {
		return nil, err
	}
	day := sql.NullInt32{}
	if req.Msg.AutoCloseDay != nil {
		day = sql.NullInt32{Int32: *req.Msg.AutoCloseDay, Valid: true}
	}
	if closeMode == royaltyCloseModeAuto && !day.Valid {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("auto_close_day is required when close_mode is automatic"))
	}
	if closeMode == royaltyCloseModeManual && day.Valid {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("auto_close_day must not be set when close_mode is manual"))
	}
	if day.Valid && (day.Int32 < 1 || day.Int32 > 28) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("auto_close_day must be between 1 and 28"))
	}

	config, err := s.queriesFor(ctx).UpsertTenantRoyaltyConfig(ctx, dbmodels.UpsertTenantRoyaltyConfigParams{
		TenantID: tenant.ID, CloseMode: closeMode, AutoCloseDay: day,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update royalty config", err, "tenant_id", tenant.ID.String())
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID: tenant.ID, ActorUserID: sessionCtx.User.ID, ActorRole: sessionCtx.Role,
		Action: "royalty_config_updated", TargetType: "royalty_config", TargetID: tenant.PublicID,
		Outcome: auditlog.OutcomeSuccess, ClientIP: auditlog.ClientIPFromHeader(req.Header()),
	})
	return connect.NewResponse(&publiraadminv1.UpdateRoyaltyConfigResponse{Config: royaltyConfigToProto(config)}), nil
}

// royaltyMonth resolves the requested period of the tenant in the tenant's
// current zone.
func (s *adminServer) royaltyMonth(ctx context.Context, tenant dbmodels.Tenant, rawPeriod string) (royalties.Month, error) {
	period, err := royalties.ParsePeriod(rawPeriod)
	if err != nil {
		return royalties.Month{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "period")
	}
	return royalties.Month{
		TenantID: tenant.ID,
		Period:   period,
		TimeZone: tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}, nil
}

// royaltyDB is the request's tenant-scoped connection, which the close and the
// preview open their own transactions on.
func (s *adminServer) royaltyDB(ctx context.Context) (royalties.TxBeginner, error) {
	if conn, ok := rpcmiddleware.TenantConnFromContext(ctx); ok {
		return conn, nil
	}
	return nil, errors.New("tenant-scoped connection is required for royalty statements")
}

// PreviewRoyaltyStatement computes a month that is not closed yet.
func (s *adminServer) PreviewRoyaltyStatement(
	ctx context.Context,
	req *connect.Request[publiraadminv1.PreviewRoyaltyStatementRequest],
) (*connect.Response[publiraadminv1.PreviewRoyaltyStatementResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	month, err := s.royaltyMonth(ctx, tenant, req.Msg.Period)
	if err != nil {
		return nil, err
	}
	db, err := s.royaltyDB(ctx)
	if err != nil {
		return nil, s.internalError(ctx, "failed to preview royalty statement", err, "tenant_id", tenant.ID.String())
	}

	computation, err := royalties.PreviewStatement(ctx, db, month, time.Now())
	switch {
	case errors.Is(err, royalties.ErrAlreadyClosed), errors.Is(err, royalties.ErrNotStarted):
		return nil, connect.NewError(connect.CodeFailedPrecondition, err)
	case err != nil:
		return nil, s.internalDBError(ctx, "failed to preview royalty statement", err,
			"tenant_id", tenant.ID.String(), "period", req.Msg.Period)
	}

	lines := make([]*publiraadminv1.RoyaltyStatementLine, 0, len(computation.Lines))
	for i, row := range computation.Lines {
		lines = append(lines, &publiraadminv1.RoyaltyStatementLine{
			LineNumber:      int32(i + 1),
			CreatorPublicId: row.CreatorPublicID,
			CreatorName:     row.CreatorName,
			SeriesPublicId:  row.SeriesPublicID,
			SeriesTitle:     row.SeriesTitle,
			EpisodePublicId: row.EpisodePublicID,
			EpisodeTitle:    row.EpisodeTitle,
			RolePublicId:    row.RolePublicID.String,
			RoleName:        row.RoleName.String,
			SaleCount:       row.SaleCount,
			GrossAmount:     row.GrossAmount,
			RefundedAmount:  row.RefundedAmount,
			ShareBps:        row.ShareBps,
			PayoutAmount:    row.PayoutAmount,
		})
	}

	return connect.NewResponse(&publiraadminv1.PreviewRoyaltyStatementResponse{
		Period:   royalties.FormatPeriod(month.Period),
		TimeZone: month.TimeZone,
		Totals: &publiraadminv1.RoyaltyStatementTotals{
			Gross:    computation.Totals.Gross,
			Refunded: computation.Totals.Refunded,
			Payout:   computation.Totals.Payout,
		},
		Lines: lines,
	}), nil
}

// CloseRoyaltyStatement closes a month that is over. The audit entry commits
// with the statement: a close cannot be repeated, so an entry the best-effort
// recorder dropped could never be written again.
func (s *adminServer) CloseRoyaltyStatement(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CloseRoyaltyStatementRequest],
) (*connect.Response[publiraadminv1.CloseRoyaltyStatementResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	month, err := s.royaltyMonth(ctx, tenant, req.Msg.Period)
	if err != nil {
		return nil, err
	}
	db, err := s.royaltyDB(ctx)
	if err != nil {
		return nil, s.internalError(ctx, "failed to close royalty statement", err, "tenant_id", tenant.ID.String())
	}

	period := royalties.FormatPeriod(month.Period)
	closedBy := uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true}
	statement, err := royalties.CloseStatement(ctx, db, month, closedBy, time.Now(),
		func(ctx context.Context, queries *dbmodels.Queries, _ dbmodels.RoyaltyStatement) error {
			return auditlog.WriteTenant(ctx, queries, s.logger, auditlog.TenantEntry{
				TenantID:    tenant.ID,
				ActorUserID: sessionCtx.User.ID,
				ActorRole:   sessionCtx.Role,
				Action:      "royalty_statement_closed",
				TargetType:  "royalty_statement",
				TargetID:    period,
				Outcome:     auditlog.OutcomeSuccess,
				ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
			})
		})
	switch {
	case errors.Is(err, royalties.ErrAlreadyClosed):
		return nil, connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, royalties.ErrNotOver):
		return nil, connect.NewError(connect.CodeFailedPrecondition, err)
	case err != nil:
		return nil, s.internalDBError(ctx, "failed to close royalty statement", err,
			"tenant_id", tenant.ID.String(), "period", period)
	}

	return connect.NewResponse(&publiraadminv1.CloseRoyaltyStatementResponse{
		Statement: royaltyStatementToProto(statement, sessionCtx.User.PublicID, sessionCtx.User.Name),
	}), nil
}

// ListRoyaltyStatements lists the closed months, newest first. A statement is
// never deleted while its tenant exists, so a boundary row cannot disappear
// and the list issues no recovery token.
func (s *adminServer) ListRoyaltyStatements(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListRoyaltyStatementsRequest],
) (*connect.Response[publiraadminv1.ListRoyaltyStatementsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultRoyaltyPageSize, maxRoyaltyPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, invalidRoyaltyTokenError()
	}
	var cursorPeriod time.Time
	if !cursor.IsZero() {
		if len(cursor.Keys) != 1 {
			return nil, invalidRoyaltyTokenError()
		}
		if cursorPeriod, err = royalties.ParsePeriod(cursor.Keys[0]); err != nil {
			return nil, invalidRoyaltyTokenError()
		}
	}

	var rows []dbmodels.ListRoyaltyStatementsDescRow
	if cursor.Direction == pagination.Backward {
		ascending, err := s.queriesFor(ctx).ListRoyaltyStatementsAsc(ctx, dbmodels.ListRoyaltyStatementsAscParams{
			TenantID:     tenant.ID,
			CursorPeriod: cursorPeriod,
			RowLimit:     limit + 1,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list royalty statements", err, "tenant_id", tenant.ID.String())
		}
		for _, row := range ascending {
			rows = append(rows, dbmodels.ListRoyaltyStatementsDescRow(row))
		}
	} else {
		rows, err = s.queriesFor(ctx).ListRoyaltyStatementsDesc(ctx, dbmodels.ListRoyaltyStatementsDescParams{
			TenantID:     tenant.ID,
			HasCursor:    !cursor.IsZero(),
			CursorPeriod: cursorPeriod,
			RowLimit:     limit + 1,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list royalty statements", err, "tenant_id", tenant.ID.String())
		}
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	statements := make([]*publiraadminv1.RoyaltyStatement, 0, len(rows))
	for _, row := range rows {
		statements = append(statements, royaltyStatementToProto(royaltyStatementOf(row), row.ClosedByUserPublicID.String, row.ClosedByUserName.String))
	}

	res := &publiraadminv1.ListRoyaltyStatementsResponse{Statements: statements}
	if len(rows) > 0 {
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.Encode(pagination.Backward, royalties.FormatPeriod(rows[0].Period))
		}
		if hasNext {
			res.NextToken = pagination.Encode(pagination.Forward, royalties.FormatPeriod(rows[len(rows)-1].Period))
		}
	}
	return connect.NewResponse(res), nil
}

// GetRoyaltyStatement reads a closed month and a page of its lines. The token
// names the period it was issued for, because a line number means a position
// in one statement only. Lines are never deleted, so no recovery token is
// issued, as in ListRoyaltyStatements.
func (s *adminServer) GetRoyaltyStatement(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetRoyaltyStatementRequest],
) (*connect.Response[publiraadminv1.GetRoyaltyStatementResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	period, err := royalties.ParsePeriod(req.Msg.Period)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "period")
	}
	periodKey := royalties.FormatPeriod(period)

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultRoyaltyPageSize, maxRoyaltyPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, invalidRoyaltyTokenError()
	}
	var cursorLine int32
	if !cursor.IsZero() {
		if len(cursor.Keys) != 2 || cursor.Keys[0] != periodKey {
			return nil, invalidRoyaltyTokenError()
		}
		parsed, err := strconv.ParseInt(cursor.Keys[1], 10, 32)
		if err != nil || parsed < 0 {
			return nil, invalidRoyaltyTokenError()
		}
		cursorLine = int32(parsed)
	}

	header, err := s.queriesFor(ctx).GetRoyaltyStatementByPeriod(ctx, dbmodels.GetRoyaltyStatementByPeriodParams{
		TenantID: tenant.ID,
		Period:   period,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("royalty statement not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get royalty statement", err, "tenant_id", tenant.ID.String(), "period", periodKey)
	}

	var rows []dbmodels.ListRoyaltyStatementLinesAscRow
	if cursor.Direction == pagination.Backward {
		descending, err := s.queriesFor(ctx).ListRoyaltyStatementLinesDesc(ctx, dbmodels.ListRoyaltyStatementLinesDescParams{
			TenantID:         tenant.ID,
			StatementID:      header.ID,
			BeforeLineNumber: cursorLine,
			RowLimit:         limit + 1,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list royalty statement lines", err, "tenant_id", tenant.ID.String(), "period", periodKey)
		}
		for _, row := range descending {
			rows = append(rows, dbmodels.ListRoyaltyStatementLinesAscRow(row))
		}
	} else {
		rows, err = s.queriesFor(ctx).ListRoyaltyStatementLinesAsc(ctx, dbmodels.ListRoyaltyStatementLinesAscParams{
			TenantID:        tenant.ID,
			StatementID:     header.ID,
			AfterLineNumber: cursorLine,
			RowLimit:        limit + 1,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list royalty statement lines", err, "tenant_id", tenant.ID.String(), "period", periodKey)
		}
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	lines := make([]*publiraadminv1.RoyaltyStatementLine, 0, len(rows))
	for _, row := range rows {
		lines = append(lines, &publiraadminv1.RoyaltyStatementLine{
			LineNumber:      row.LineNumber,
			CreatorPublicId: row.CreatorPublicID.String,
			CreatorName:     row.CreatorName,
			SeriesPublicId:  row.SeriesPublicID.String,
			SeriesTitle:     row.SeriesTitle,
			EpisodePublicId: row.EpisodePublicID.String,
			EpisodeTitle:    row.EpisodeTitle,
			RolePublicId:    row.RolePublicID.String,
			RoleName:        row.RoleName.String,
			SaleCount:       row.SaleCount,
			GrossAmount:     row.GrossAmount,
			RefundedAmount:  row.RefundedAmount,
			ShareBps:        row.ShareBps,
			PayoutAmount:    row.PayoutAmount,
		})
	}

	res := &publiraadminv1.GetRoyaltyStatementResponse{
		Statement: royaltyStatementToProto(royaltyStatementOf(dbmodels.ListRoyaltyStatementsDescRow(header)), header.ClosedByUserPublicID.String, header.ClosedByUserName.String),
		Lines:     lines,
	}
	if len(rows) > 0 {
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.Encode(pagination.Backward, periodKey, strconv.Itoa(int(rows[0].LineNumber)))
		}
		if hasNext {
			res.NextToken = pagination.Encode(pagination.Forward, periodKey, strconv.Itoa(int(rows[len(rows)-1].LineNumber)))
		}
	}
	return connect.NewResponse(res), nil
}

func invalidRoyaltyTokenError() error {
	return connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
}

func royaltyStatementOf(row dbmodels.ListRoyaltyStatementsDescRow) dbmodels.RoyaltyStatement {
	return dbmodels.RoyaltyStatement{
		ID:             row.ID,
		TenantID:       row.TenantID,
		Period:         row.Period,
		TimeZone:       row.TimeZone,
		ClosedAt:       row.ClosedAt,
		ClosedByUserID: row.ClosedByUserID,
		TotalGross:     row.TotalGross,
		TotalRefunded:  row.TotalRefunded,
		TotalPayout:    row.TotalPayout,
	}
}

func royaltyStatementToProto(statement dbmodels.RoyaltyStatement, closedByPublicID, closedByName string) *publiraadminv1.RoyaltyStatement {
	return &publiraadminv1.RoyaltyStatement{
		Period:               royalties.FormatPeriod(statement.Period),
		TimeZone:             statement.TimeZone,
		ClosedAt:             statement.ClosedAt.UTC().Format(time.RFC3339),
		ClosedByUserPublicId: closedByPublicID,
		ClosedByUserName:     closedByName,
		Totals: &publiraadminv1.RoyaltyStatementTotals{
			Gross:    statement.TotalGross,
			Refunded: statement.TotalRefunded,
			Payout:   statement.TotalPayout,
		},
	}
}
