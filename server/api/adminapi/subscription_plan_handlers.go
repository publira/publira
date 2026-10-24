package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	// maxSubscriptionPlans bounds how many plans one tenant holds, which is
	// what lets every list of them go unpaged. A reader holds one plan at a
	// time, so a tenant offering more than this many is offering choices no
	// reader compares.
	maxSubscriptionPlans = 20

	// maxSubscriptionPlanNameRunes and maxSubscriptionPlanDescriptionRunes
	// bound what a plan page shows. They count code points, so a name costs
	// the same length in every script.
	maxSubscriptionPlanNameRunes        = 100
	maxSubscriptionPlanDescriptionRunes = 2000

	// maxSubscriptionPlanTargets bounds the labels or series one plan names. A
	// plan that would name more is closer to the whole catalog, which
	// SUBSCRIPTION_PLAN_SCOPE_ALL is for.
	maxSubscriptionPlanTargets = 100

	// subscriptionPlanStripePriceIDKey is the constraint that keeps one Price
	// on one plan of a tenant.
	subscriptionPlanStripePriceIDKey = "subscription_plans_tenant_stripe_price_id_key"
)

var errSubscriptionPlanLimit = errors.New("the tenant holds as many subscription plans as it may")

// subscriptionPlanInput is a plan's fields, read and checked from a request.
type subscriptionPlanInput struct {
	name          string
	description   string
	stripePriceID string
	scope         string
	labelIDs      []uuid.UUID
	seriesIDs     []uuid.UUID
	published     bool
}

// readSubscriptionPlanInput checks the fields a plan is saved with. Whether
// the labels, the series, and the Price exist is for the caller to ask the
// database and Stripe.
func readSubscriptionPlanInput(req *publiraadminv1.SubscriptionPlanInput) (subscriptionPlanInput, error) {
	if req == nil {
		return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("plan is required"), "plan")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("name is required"), "plan.name")
	}
	if utf8.RuneCountInString(name) > maxSubscriptionPlanNameRunes {
		return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("name must be at most %d characters", maxSubscriptionPlanNameRunes), "plan.name")
	}
	description := strings.TrimSpace(req.Description)
	if utf8.RuneCountInString(description) > maxSubscriptionPlanDescriptionRunes {
		return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("description must be at most %d characters", maxSubscriptionPlanDescriptionRunes), "plan.description")
	}
	stripePriceID := strings.TrimSpace(req.StripePriceId)
	if stripePriceID == "" {
		return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("stripe_price_id is required"), "plan.stripe_price_id")
	}
	scope, err := protomapper.SubscriptionPlanScopeFromRequest(req.Scope)
	if err != nil {
		return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("scope must name what the plan opens"), "plan.scope")
	}
	labelIDs, err := readSubscriptionPlanTargetIDs(req.LabelIds, "plan.label_ids")
	if err != nil {
		return subscriptionPlanInput{}, err
	}
	seriesIDs, err := readSubscriptionPlanTargetIDs(req.SeriesIds, "plan.series_ids")
	if err != nil {
		return subscriptionPlanInput{}, err
	}
	switch scope {
	case protomapper.SubscriptionPlanScopeAll:
		if len(labelIDs) > 0 || len(seriesIDs) > 0 {
			return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("a plan of the whole catalog names no labels and no series"), "plan.scope")
		}
	case protomapper.SubscriptionPlanScopeLabel:
		if len(labelIDs) == 0 {
			return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("a plan of labels names at least one label"), "plan.label_ids")
		}
		if len(seriesIDs) > 0 {
			return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("a plan of labels names no series"), "plan.series_ids")
		}
	case protomapper.SubscriptionPlanScopeSeries:
		if len(seriesIDs) == 0 {
			return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("a plan of series names at least one series"), "plan.series_ids")
		}
		if len(labelIDs) > 0 {
			return subscriptionPlanInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("a plan of series names no labels"), "plan.label_ids")
		}
	}
	return subscriptionPlanInput{
		name:          name,
		description:   description,
		stripePriceID: stripePriceID,
		scope:         scope,
		labelIDs:      labelIDs,
		seriesIDs:     seriesIDs,
		published:     req.Published,
	}, nil
}

// readSubscriptionPlanTargetIDs parses the primary keys of a plan's labels or
// series. A key named twice counts once.
func readSubscriptionPlanTargetIDs(raw []string, field string) ([]uuid.UUID, error) {
	if len(raw) > maxSubscriptionPlanTargets {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("a plan names at most %d targets", maxSubscriptionPlanTargets), field)
	}
	ids := make([]uuid.UUID, 0, len(raw))
	for _, value := range raw {
		id, err := parseRecordID(value, field)
		if err != nil {
			return nil, err
		}
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// describeSubscriptionPrice asks the tenant's Stripe account for the Price a
// plan is saved with, which has to be an active one billed every period.
func (s *adminServer) describeSubscriptionPrice(ctx context.Context, tenantID uuid.UUID, priceID string) (paymentprovider.Price, error) {
	payments, credentials, err := s.paymentStore(ctx).LoadEnabledSecrets(ctx, tenantID)
	if paymentsettings.IsUnavailable(err) {
		return paymentprovider.Price{}, connect.NewError(connect.CodeFailedPrecondition, "the tenant's payment settings are not enabled")
	}
	if err != nil {
		return paymentprovider.Price{}, s.internalDBError(ctx, "failed to load payment settings for a subscription plan", err, "tenant_id", tenantID.String())
	}
	provider, ok := s.paymentProviders.Lookup(payments.Provider)
	if !ok {
		return paymentprovider.Price{}, connect.NewError(connect.CodeFailedPrecondition, "the tenant's payment provider is not registered on this server")
	}
	subscriptions, ok := provider.(paymentprovider.Subscriptions)
	if !ok {
		return paymentprovider.Price{}, connect.NewError(connect.CodeFailedPrecondition, "the tenant's payment provider sells no subscriptions")
	}
	price, err := subscriptions.DescribePrice(ctx, credentials, priceID)
	if errors.Is(err, paymentprovider.ErrPriceNotFound) {
		return paymentprovider.Price{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("stripe_price_id names no recurring price of one fixed amount on the tenant's Stripe account"), "plan.stripe_price_id")
	}
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to read a price from the payment provider", "error", err, "tenant_id", tenantID, "price_id", priceID)
		return paymentprovider.Price{}, connect.NewError(connect.CodeUnavailable, "failed to read the price from the payment provider")
	}
	if !price.Active {
		return paymentprovider.Price{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("stripe_price_id names an archived price"), "plan.stripe_price_id")
	}
	if price.Amount < 0 || price.Amount > math.MaxInt32 || price.IntervalCount < 1 || price.IntervalCount > math.MaxInt32 {
		return paymentprovider.Price{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("stripe_price_id names a price whose amount or interval this server cannot hold"), "plan.stripe_price_id")
	}
	return price, nil
}

// checkSubscriptionPlanTargets refuses labels or series the tenant does not
// hold. The composite foreign keys would refuse them too, but as a fault
// rather than as the field the caller got wrong.
func (s *adminServer) checkSubscriptionPlanTargets(ctx context.Context, tenantID uuid.UUID, input subscriptionPlanInput) error {
	queries := s.queriesFor(ctx)
	if len(input.labelIDs) > 0 {
		count, err := queries.CountLabelsForSubscriptionPlan(ctx, dbmodels.CountLabelsForSubscriptionPlanParams{TenantID: tenantID, Ids: input.labelIDs})
		if err != nil {
			return s.internalDBError(ctx, "failed to check the labels of a subscription plan", err, "tenant_id", tenantID.String())
		}
		if int(count) != len(input.labelIDs) {
			return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("label_ids names a label the tenant does not hold"), "plan.label_ids")
		}
	}
	if len(input.seriesIDs) > 0 {
		count, err := queries.CountSeriesForSubscriptionPlan(ctx, dbmodels.CountSeriesForSubscriptionPlanParams{TenantID: tenantID, Ids: input.seriesIDs})
		if err != nil {
			return s.internalDBError(ctx, "failed to check the series of a subscription plan", err, "tenant_id", tenantID.String())
		}
		if int(count) != len(input.seriesIDs) {
			return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("series_ids names a series the tenant does not hold"), "plan.series_ids")
		}
	}
	return nil
}

// replaceSubscriptionPlanTargets writes the plan's labels or series in place of
// the ones it had.
func (s *adminServer) replaceSubscriptionPlanTargets(ctx context.Context, tenantID, planID uuid.UUID, input subscriptionPlanInput) error {
	queries := s.queriesFor(ctx)
	if err := queries.DeleteSubscriptionPlanTargets(ctx, dbmodels.DeleteSubscriptionPlanTargetsParams{TenantID: tenantID, PlanID: planID}); err != nil {
		return s.internalDBError(ctx, "failed to clear the targets of a subscription plan", err, "tenant_id", tenantID.String(), "subscription_plan_id", planID.String())
	}
	if len(input.labelIDs) > 0 {
		if err := queries.CreateSubscriptionPlanLabelTargets(ctx, dbmodels.CreateSubscriptionPlanLabelTargetsParams{TenantID: tenantID, PlanID: planID, LabelIds: input.labelIDs}); err != nil {
			return s.internalDBError(ctx, "failed to store the labels of a subscription plan", err, "tenant_id", tenantID.String(), "subscription_plan_id", planID.String())
		}
	}
	if len(input.seriesIDs) > 0 {
		if err := queries.CreateSubscriptionPlanSeriesTargets(ctx, dbmodels.CreateSubscriptionPlanSeriesTargetsParams{TenantID: tenantID, PlanID: planID, SeriesIds: input.seriesIDs}); err != nil {
			return s.internalDBError(ctx, "failed to store the series of a subscription plan", err, "tenant_id", tenantID.String(), "subscription_plan_id", planID.String())
		}
	}
	return nil
}

// subscriptionPlanWriteError reports a Price another plan of the tenant
// already names as that field, and anything else as a fault.
func (s *adminServer) subscriptionPlanWriteError(ctx context.Context, message string, err error, tenantID uuid.UUID) error {
	if dberr.UniqueViolationConstraint(err) == subscriptionPlanStripePriceIDKey {
		return rpcerrors.NewFieldViolationError(connect.CodeAlreadyExists, errors.New("another subscription plan already bills this price"), "plan.stripe_price_id")
	}
	return s.internalDBError(ctx, message, err, "tenant_id", tenantID.String())
}

// recordSubscriptionPlanChange files the audit entry for one plan write. A
// plan is what readers are billed for every period, so every write is
// recorded, not only the destructive one.
func (s *adminServer) recordSubscriptionPlanChange(ctx context.Context, tenantID uuid.UUID, action, targetID string) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  "subscription_plan",
		TargetID:    targetID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientip.FromContext(ctx),
	})
}

func (s *adminServer) ListSubscriptionPlans(
	ctx context.Context,
	req *publiraadminv1.ListSubscriptionPlansRequest,
) (*publiraadminv1.ListSubscriptionPlansResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListSubscriptionPlansForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list subscription plans", err, "tenant_id", tenant.ID.String())
	}
	planRows := make([]dbmodels.GetSubscriptionPlanByIDForTenantRow, 0, len(rows))
	for _, row := range rows {
		planRows = append(planRows, dbmodels.GetSubscriptionPlanByIDForTenantRow(row))
	}
	plans, err := s.subscriptionPlanMessages(ctx, tenant.ID, planRows)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ListSubscriptionPlansResponse{Plans: plans}, nil
}

func (s *adminServer) GetSubscriptionPlan(
	ctx context.Context,
	req *publiraadminv1.GetSubscriptionPlanRequest,
) (*publiraadminv1.GetSubscriptionPlanResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.SubscriptionPlanId, "subscription_plan_id")
	if err != nil {
		return nil, err
	}
	plan, err := s.subscriptionPlanMessageByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.GetSubscriptionPlanResponse{Plan: plan}, nil
}

func (s *adminServer) CreateSubscriptionPlan(
	ctx context.Context,
	req *publiraadminv1.CreateSubscriptionPlanRequest,
) (*publiraadminv1.CreateSubscriptionPlanResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	input, err := readSubscriptionPlanInput(req.Plan)
	if err != nil {
		return nil, err
	}
	price, err := s.describeSubscriptionPrice(ctx, tenant.ID, input.stripePriceID)
	if err != nil {
		return nil, err
	}
	planID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create subscription plan transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	queries := s.queriesFor(txCtx)

	if _, err := queries.LockTenantForSubscriptionPlans(txCtx, tenant.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock the tenant for a subscription plan create", err, "tenant_id", tenant.ID.String())
	}
	count, err := queries.CountSubscriptionPlansForTenant(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count subscription plans", err, "tenant_id", tenant.ID.String())
	}
	if count >= maxSubscriptionPlans {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errSubscriptionPlanLimit, rpcerrors.ReasonSubscriptionPlanLimit)
	}
	if err := s.checkSubscriptionPlanTargets(txCtx, tenant.ID, input); err != nil {
		return nil, err
	}
	created, err := publicid.InsertTx(txCtx, tx, func(publicID string) (dbmodels.CreateSubscriptionPlanRow, error) {
		return queries.CreateSubscriptionPlan(txCtx, dbmodels.CreateSubscriptionPlanParams{
			ID:                     planID,
			TenantID:               tenant.ID,
			PublicID:               publicID,
			Name:                   input.name,
			Description:            input.description,
			StripePriceID:          input.stripePriceID,
			PriceAmount:            int32(price.Amount),
			Currency:               price.Currency,
			RecurringInterval:      string(price.Interval),
			RecurringIntervalCount: int32(price.IntervalCount),
			Scope:                  input.scope,
			IsPublished:            input.published,
		})
	})
	if err != nil {
		return nil, s.subscriptionPlanWriteError(ctx, "failed to create subscription plan", err, tenant.ID)
	}
	if err := s.replaceSubscriptionPlanTargets(txCtx, tenant.ID, created.ID, input); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create subscription plan", err, "tenant_id", tenant.ID.String())
	}

	s.recordSubscriptionPlanChange(ctx, tenant.ID, "subscription_plan_created", created.PublicID)

	plan, err := s.subscriptionPlanMessageByID(ctx, tenant.ID, created.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.CreateSubscriptionPlanResponse{Plan: plan}, nil
}

func (s *adminServer) UpdateSubscriptionPlan(
	ctx context.Context,
	req *publiraadminv1.UpdateSubscriptionPlanRequest,
) (*publiraadminv1.UpdateSubscriptionPlanResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.SubscriptionPlanId, "subscription_plan_id")
	if err != nil {
		return nil, err
	}
	input, err := readSubscriptionPlanInput(req.Plan)
	if err != nil {
		return nil, err
	}
	current, err := s.subscriptionPlanByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	// The Price is asked of Stripe only when it changes. What a Price bills
	// never changes in Stripe, so the amounts already stored stay true of it,
	// and renaming a plan does not need Stripe to answer.
	price := paymentprovider.Price{
		Amount:        int64(current.PriceAmount),
		Currency:      current.Currency,
		Interval:      paymentprovider.Interval(current.RecurringInterval),
		IntervalCount: int64(current.RecurringIntervalCount),
	}
	if input.stripePriceID != current.StripePriceID {
		price, err = s.describeSubscriptionPrice(ctx, tenant.ID, input.stripePriceID)
		if err != nil {
			return nil, err
		}
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update subscription plan transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	if err := s.checkSubscriptionPlanTargets(txCtx, tenant.ID, input); err != nil {
		return nil, err
	}
	updated, err := s.queriesFor(txCtx).UpdateSubscriptionPlan(txCtx, dbmodels.UpdateSubscriptionPlanParams{
		TenantID:               tenant.ID,
		ID:                     current.ID,
		Name:                   input.name,
		Description:            input.description,
		StripePriceID:          input.stripePriceID,
		PriceAmount:            int32(price.Amount),
		Currency:               price.Currency,
		RecurringInterval:      string(price.Interval),
		RecurringIntervalCount: int32(price.IntervalCount),
		Scope:                  input.scope,
		IsPublished:            input.published,
	})
	if err != nil {
		return nil, s.subscriptionPlanWriteError(ctx, "failed to update subscription plan", err, tenant.ID)
	}
	if updated == 0 {
		return nil, connect.NewError(connect.CodeNotFound, "subscription plan not found")
	}
	if err := s.replaceSubscriptionPlanTargets(txCtx, tenant.ID, current.ID, input); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update subscription plan", err, "tenant_id", tenant.ID.String())
	}

	s.recordSubscriptionPlanChange(ctx, tenant.ID, "subscription_plan_updated", current.PublicID)

	plan, err := s.subscriptionPlanMessageByID(ctx, tenant.ID, current.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UpdateSubscriptionPlanResponse{Plan: plan}, nil
}

func (s *adminServer) DeleteSubscriptionPlan(
	ctx context.Context,
	req *publiraadminv1.DeleteSubscriptionPlanRequest,
) (*publiraadminv1.DeleteSubscriptionPlanResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.SubscriptionPlanId, "subscription_plan_id")
	if err != nil {
		return nil, err
	}
	current, err := s.subscriptionPlanByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	queries := s.queriesFor(ctx)
	subscribed, err := queries.CountSubscriptionsAndCheckoutsForPlan(ctx, dbmodels.CountSubscriptionsAndCheckoutsForPlanParams{TenantID: tenant.ID, PlanID: current.ID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count the subscriptions of a plan", err, "tenant_id", tenant.ID.String(), "subscription_plan_id", current.ID.String())
	}
	if subscribed > 0 {
		return nil, subscriptionPlanInUseError()
	}
	if _, err := queries.DeleteSubscriptionPlan(ctx, dbmodels.DeleteSubscriptionPlanParams{TenantID: tenant.ID, ID: current.ID}); err != nil {
		// A subscription or a checkout can be recorded between the count and
		// the delete.
		// The foreign key is what actually holds the line, so its refusal is
		// reported as the same failed precondition rather than as a fault.
		if dberr.IsForeignKeyViolation(err) {
			return nil, subscriptionPlanInUseError()
		}
		return nil, s.internalDBError(ctx, "failed to delete subscription plan", err, "tenant_id", tenant.ID.String(), "subscription_plan_id", current.ID.String())
	}

	s.recordSubscriptionPlanChange(ctx, tenant.ID, "subscription_plan_deleted", current.PublicID)

	return &publiraadminv1.DeleteSubscriptionPlanResponse{}, nil
}

// subscriptionPlanInUseError refuses to delete a plan a subscription or a
// reader's latest checkout names.
func subscriptionPlanInUseError() error {
	return rpcerrors.NewErrorInfoError(
		connect.CodeFailedPrecondition,
		errors.New("subscription plan has subscriptions and cannot be deleted"),
		rpcerrors.ReasonSubscriptionPlanInUse,
	)
}

// subscriptionPlanByID reads the plan a request names.
func (s *adminServer) subscriptionPlanByID(ctx context.Context, tenantID, id uuid.UUID) (dbmodels.GetSubscriptionPlanByIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).GetSubscriptionPlanByIDForTenant(ctx, dbmodels.GetSubscriptionPlanByIDForTenantParams{TenantID: tenantID, ID: id})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.GetSubscriptionPlanByIDForTenantRow{}, connect.NewError(connect.CodeNotFound, "subscription plan not found")
	}
	if err != nil {
		return dbmodels.GetSubscriptionPlanByIDForTenantRow{}, s.internalDBError(ctx, "failed to get subscription plan", err, "tenant_id", tenantID.String(), "subscription_plan_id", id.String())
	}
	return row, nil
}

func (s *adminServer) subscriptionPlanMessageByID(ctx context.Context, tenantID, id uuid.UUID) (*publiraadminv1.AdminSubscriptionPlan, error) {
	row, err := s.subscriptionPlanByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	plans, err := s.subscriptionPlanMessages(ctx, tenantID, []dbmodels.GetSubscriptionPlanByIDForTenantRow{row})
	if err != nil {
		return nil, err
	}
	return plans[0], nil
}

// subscriptionPlanMessages answers the plans with the labels and series each
// names.
func (s *adminServer) subscriptionPlanMessages(ctx context.Context, tenantID uuid.UUID, rows []dbmodels.GetSubscriptionPlanByIDForTenantRow) ([]*publiraadminv1.AdminSubscriptionPlan, error) {
	plans := make([]*publiraadminv1.AdminSubscriptionPlan, 0, len(rows))
	if len(rows) == 0 {
		return plans, nil
	}
	planIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		planIDs = append(planIDs, row.ID)
	}
	targets, err := s.queriesFor(ctx).ListSubscriptionPlanTargetsForTenant(ctx, dbmodels.ListSubscriptionPlanTargetsForTenantParams{TenantID: tenantID, PlanIds: planIDs})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list subscription plan targets", err, "tenant_id", tenantID.String())
	}
	labelIDs := make(map[uuid.UUID][]string, len(rows))
	seriesIDs := make(map[uuid.UUID][]string, len(rows))
	for _, target := range targets {
		if target.LabelID.Valid {
			labelIDs[target.PlanID] = append(labelIDs[target.PlanID], target.LabelID.UUID.String())
		}
		if target.SeriesID.Valid {
			seriesIDs[target.PlanID] = append(seriesIDs[target.PlanID], target.SeriesID.UUID.String())
		}
	}
	for _, row := range rows {
		scope, err := protomapper.SubscriptionPlanScopeFromStored(row.Scope)
		if err != nil {
			return nil, s.internalError(ctx, "subscription plan holds a scope this build does not know", err, "tenant_id", tenantID.String(), "subscription_plan_id", row.ID.String())
		}
		interval, err := protomapper.SubscriptionIntervalFromStored(row.RecurringInterval)
		if err != nil {
			return nil, s.internalError(ctx, "subscription plan holds an interval this build does not know", err, "tenant_id", tenantID.String(), "subscription_plan_id", row.ID.String())
		}
		plans = append(plans, &publiraadminv1.AdminSubscriptionPlan{
			Id:              row.ID.String(),
			PublicId:        row.PublicID,
			Name:            row.Name,
			Description:     row.Description,
			StripePriceId:   row.StripePriceID,
			PriceAmount:     row.PriceAmount,
			Currency:        row.Currency,
			Interval:        interval,
			IntervalCount:   row.RecurringIntervalCount,
			Scope:           scope,
			LabelIds:        labelIDs[row.ID],
			SeriesIds:       seriesIDs[row.ID],
			Published:       row.IsPublished,
			SubscriberCount: row.SubscriberCount,
			CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
			UpdatedAt:       row.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	return plans, nil
}
