package publicapi

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantorigin"
)

// subscriptionPlanFields are the columns of a plan the public answer carries,
// read by more than one query.
type subscriptionPlanFields struct {
	id                     uuid.UUID
	publicID               string
	name                   string
	description            string
	priceAmount            int32
	currency               string
	recurringInterval      string
	recurringIntervalCount int32
	scope                  string
}

// subscriptionPlanTargets are the labels or the series one plan opens.
type subscriptionPlanTargets struct {
	labelIDs  []string
	seriesIDs []string
}

func (s *apiServer) ListSubscriptionPlans(
	ctx context.Context,
	req *publirav1.ListSubscriptionPlansRequest,
) (*publirav1.ListSubscriptionPlansResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListPublishedSubscriptionPlansForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published subscription plans", err, "tenant_id", tenant.ID.String())
	}
	planIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		planIDs = append(planIDs, row.ID)
	}
	targets, err := s.subscriptionPlanTargets(ctx, tenant.ID, planIDs)
	if err != nil {
		return nil, err
	}
	plans := make([]*publirav1.SubscriptionPlan, 0, len(rows))
	for _, row := range rows {
		plan, err := subscriptionPlanMessage(subscriptionPlanFields{
			id:                     row.ID,
			publicID:               row.PublicID,
			name:                   row.Name,
			description:            row.Description,
			priceAmount:            row.PriceAmount,
			currency:               row.Currency,
			recurringInterval:      row.RecurringInterval,
			recurringIntervalCount: row.RecurringIntervalCount,
			scope:                  row.Scope,
		}, targets[row.ID])
		if err != nil {
			return nil, s.internalError(ctx, "subscription plan holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "subscription_plan_id", row.ID.String())
		}
		plans = append(plans, plan)
	}
	return &publirav1.ListSubscriptionPlansResponse{Plans: plans}, nil
}

func (s *apiServer) StartSubscriptionCheckout(
	ctx context.Context,
	req *publirav1.StartSubscriptionCheckoutRequest,
) (*publirav1.StartSubscriptionCheckoutResponse, error) {
	planID, err := requestRecordID("plan_id", req.PlanId)
	if err != nil {
		return nil, err
	}
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionStartSubscriptionCheckout, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	origin, err := tenantorigin.Site(tenant)
	if errors.Is(err, tenantorigin.ErrDomainNotConfigured) {
		s.logger.WarnContext(ctx, "subscription checkout refused because tenant domain is not configured", "tenant_id", tenant.ID)
		return nil, connect.NewError(connect.CodeFailedPrecondition, err.Error()).WithCause(err)
	}
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the tenant site origin", err, "tenant_id", tenant.ID.String())
	}
	subscriptions, credentials, err := s.loadSubscriptionProvider(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	plan, err := s.queriesFor(ctx).GetPublishedSubscriptionPlanByIDForTenant(ctx, dbmodels.GetPublishedSubscriptionPlanByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       planID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeNotFound, "subscription plan not found")
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get the subscription plan", err, "tenant_id", tenant.ID.String(), "subscription_plan_id", planID.String())
	}

	// The reader's checkouts are serialized from here to the commit, provider
	// calls included, so two requests cannot each find no open checkout and
	// each start one: a reader who paid both would hold two subscriptions.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin the subscription checkout transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	if err := queries.LockSubscriptionCheckoutsOfUser(ctx, dbmodels.LockSubscriptionCheckoutsOfUserParams{TenantID: tenant.ID, UserID: user.ID}); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock the reader's subscription checkouts", err, "tenant_id", tenant.ID.String())
	}
	reader := uuid.NullUUID{UUID: user.ID, Valid: true}
	holds, err := queries.UserHoldsLiveSubscription(ctx, dbmodels.UserHoldsLiveSubscriptionParams{TenantID: tenant.ID, UserID: reader})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to check the reader's subscriptions", err, "tenant_id", tenant.ID.String())
	}
	if holds {
		return nil, readerHoldsSubscriptionError()
	}
	previous, err := queries.GetSubscriptionCheckoutForUser(ctx, dbmodels.GetSubscriptionCheckoutForUserParams{TenantID: tenant.ID, UserID: user.ID})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's latest subscription checkout", err, "tenant_id", tenant.ID.String())
	}
	if err == nil {
		reused, err := s.settlePreviousSubscriptionCheckout(ctx, queries, subscriptions, credentials, tenant.ID, plan.ID, previous)
		if err != nil {
			return nil, err
		}
		if reused != "" {
			return &publirav1.StartSubscriptionCheckoutResponse{CheckoutUrl: reused}, nil
		}
	}
	customerID, err := queries.GetLatestStripeCustomerIDForUser(ctx, dbmodels.GetLatestStripeCustomerIDForUserParams{TenantID: tenant.ID, UserID: reader})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's Stripe customer", err, "tenant_id", tenant.ID.String())
	}

	request := paymentprovider.SubscriptionCheckoutRequest{
		TenantID:   tenant.ID,
		ReaderID:   user.ID,
		PlanID:     plan.ID,
		PriceID:    plan.StripePriceID,
		CustomerID: customerID,
		SuccessURL: subscriptionReturnURL(origin, "my", "success"),
		CancelURL:  subscriptionReturnURL(origin, "plans", "cancelled"),
	}
	request.IdempotencyKey, err = subscriptionCheckoutIdempotencyKey(request, previous.StripeCheckoutSessionID)
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the subscription checkout idempotency key", err, "tenant_id", tenant.ID.String(), "subscription_plan_id", plan.ID.String())
	}
	checkout, err := subscriptions.StartSubscriptionCheckout(ctx, credentials, request)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to start a subscription checkout with the payment provider", "error", err, "tenant_id", tenant.ID, "subscription_plan_id", plan.ID.String())
		return nil, connect.NewError(connect.CodeUnavailable, "failed to start checkout")
	}
	if err := queries.RecordSubscriptionCheckout(ctx, dbmodels.RecordSubscriptionCheckoutParams{
		TenantID:                tenant.ID,
		UserID:                  user.ID,
		PlanID:                  plan.ID,
		StripeCheckoutSessionID: checkout.ID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to record the subscription checkout", err, "tenant_id", tenant.ID.String(), "checkout_id", checkout.ID)
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit the subscription checkout", err, "tenant_id", tenant.ID.String(), "checkout_id", checkout.ID)
	}
	return &publirav1.StartSubscriptionCheckoutResponse{CheckoutUrl: checkout.URL}, nil
}

func readerHoldsSubscriptionError() error {
	return connect.NewError(connect.CodeAlreadyExists, "the reader already holds a subscription")
}

// settlePreviousSubscriptionCheckout deals with the reader's latest checkout
// before another is started, so at most one checkout of a reader can ever be
// paid. One still open on the same plan is reused, and its URL answered; one
// open on another plan is expired. One the reader has paid is a subscription
// already_exists refuses a second of, unless that subscription is recorded and
// has ended: one not recorded yet is on its way, and one recorded since the
// reader's live subscriptions were checked may have been recorded live, since
// the webhook records it under a lock of its own. An expired one leaves
// nothing to do.
func (s *apiServer) settlePreviousSubscriptionCheckout(
	ctx context.Context,
	queries *dbmodels.Queries,
	subscriptions paymentprovider.Subscriptions,
	credentials paymentprovider.Credentials,
	tenantID uuid.UUID,
	planID uuid.UUID,
	previous dbmodels.GetSubscriptionCheckoutForUserRow,
) (string, error) {
	checkout, err := subscriptions.GetSubscriptionCheckout(ctx, credentials, previous.StripeCheckoutSessionID)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to read the reader's latest subscription checkout from the payment provider", "error", err, "tenant_id", tenantID, "checkout_id", previous.StripeCheckoutSessionID)
		return "", connect.NewError(connect.CodeUnavailable, "failed to start checkout")
	}
	if checkout.Status == paymentprovider.SubscriptionCheckoutOpen {
		if previous.PlanID == planID && checkout.URL != "" {
			return checkout.URL, nil
		}
		err := subscriptions.ExpireSubscriptionCheckout(ctx, credentials, checkout.ID)
		switch {
		case err == nil:
			return "", nil
		case errors.Is(err, paymentprovider.ErrCheckoutNotOpen):
			// The reader finished paying it, or it expired, after it was read.
			checkout, err = subscriptions.GetSubscriptionCheckout(ctx, credentials, checkout.ID)
			if err != nil {
				s.logger.ErrorContext(ctx, "failed to read the reader's latest subscription checkout from the payment provider", "error", err, "tenant_id", tenantID, "checkout_id", previous.StripeCheckoutSessionID)
				return "", connect.NewError(connect.CodeUnavailable, "failed to start checkout")
			}
		default:
			s.logger.ErrorContext(ctx, "failed to expire the reader's latest subscription checkout", "error", err, "tenant_id", tenantID, "checkout_id", checkout.ID)
			return "", connect.NewError(connect.CodeUnavailable, "failed to start checkout")
		}
	}
	if checkout.Status != paymentprovider.SubscriptionCheckoutComplete {
		return "", nil
	}
	ended, err := queries.SubscriptionHasEnded(ctx, dbmodels.SubscriptionHasEndedParams{TenantID: tenantID, StripeSubscriptionID: checkout.SubscriptionID})
	if err != nil {
		return "", s.internalDBError(ctx, "failed to check whether a paid checkout's subscription has ended", err, "tenant_id", tenantID.String(), "checkout_id", checkout.ID)
	}
	if !ended {
		return "", readerHoldsSubscriptionError()
	}
	return "", nil
}

// subscriptionCheckoutIdempotencyKey names one reader's checkout of one plan
// by everything the request sends, so a retried request reuses the provider's
// checkout, as checkoutIdempotencyKey does for an episode. It also names the
// checkout the reader started before this one, which every new checkout
// replaces, so the next attempt after it is a new checkout rather than the one
// the provider would answer the same request with for a day.
func subscriptionCheckoutIdempotencyKey(req paymentprovider.SubscriptionCheckoutRequest, previousCheckoutID string) (string, error) {
	req.IdempotencyKey = ""
	encoded, err := json.Marshal(struct {
		Request            paymentprovider.SubscriptionCheckoutRequest
		PreviousCheckoutID string
	}{req, previousCheckoutID})
	if err != nil {
		return "", fmt.Errorf("encode subscription checkout request: %w", err)
	}
	sum := sha256.Sum256(encoded)
	return fmt.Sprintf("subscription-checkout:%s:%s:%s:%x", req.TenantID, req.ReaderID, req.PlanID, sum[:16]), nil
}

func subscriptionReturnURL(base *url.URL, page, status string) string {
	result := *base
	result.Path, _ = url.JoinPath("/", page)
	query := url.Values{}
	query.Set("subscription", status)
	result.RawQuery = query.Encode()
	return result.String()
}

func (s *apiServer) GetMySubscription(
	ctx context.Context,
	req *publirav1.GetMySubscriptionRequest,
) (*publirav1.GetMySubscriptionResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	queries := s.queriesFor(ctx)
	row, err := queries.GetMySubscription(ctx, dbmodels.GetMySubscriptionParams{
		TenantID: tenant.ID,
		UserID:   uuid.NullUUID{UUID: user.ID, Valid: true},
	})
	if errors.Is(err, sql.ErrNoRows) {
		return &publirav1.GetMySubscriptionResponse{}, nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get the reader's subscription", err, "tenant_id", tenant.ID.String())
	}
	planRow, err := queries.GetSubscriptionPlanByIDForTenant(ctx, dbmodels.GetSubscriptionPlanByIDForTenantParams{TenantID: tenant.ID, ID: row.PlanID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get the plan of the reader's subscription", err, "tenant_id", tenant.ID.String(), "subscription_plan_id", row.PlanID.String())
	}
	targets, err := s.subscriptionPlanTargets(ctx, tenant.ID, []uuid.UUID{planRow.ID})
	if err != nil {
		return nil, err
	}
	plan, err := subscriptionPlanMessage(subscriptionPlanFields{
		id:                     planRow.ID,
		publicID:               planRow.PublicID,
		name:                   planRow.Name,
		description:            planRow.Description,
		priceAmount:            planRow.PriceAmount,
		currency:               planRow.Currency,
		recurringInterval:      planRow.RecurringInterval,
		recurringIntervalCount: planRow.RecurringIntervalCount,
		scope:                  planRow.Scope,
	}, targets[planRow.ID])
	if err != nil {
		return nil, s.internalError(ctx, "subscription plan holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "subscription_plan_id", planRow.ID.String())
	}
	status, err := protomapper.SubscriptionStatusFromStored(row.Status)
	if err != nil {
		return nil, s.internalError(ctx, "subscription holds a status this build does not know", err, "tenant_id", tenant.ID.String(), "subscription_id", row.ID.String())
	}
	subscription := &publirav1.Subscription{
		Id:                row.ID.String(),
		Plan:              plan,
		Status:            status,
		CancelAtPeriodEnd: row.CancelAtPeriodEnd,
		CreatedAt:         row.CreatedAt.UTC().Format(time.RFC3339),
	}
	if row.CurrentPeriodEnd.Valid {
		subscription.CurrentPeriodEnd = row.CurrentPeriodEnd.Time.UTC().Format(time.RFC3339)
	}
	return &publirav1.GetMySubscriptionResponse{Subscription: subscription}, nil
}

func (s *apiServer) CreateBillingPortalSession(
	ctx context.Context,
	req *publirav1.CreateBillingPortalSessionRequest,
) (*publirav1.CreateBillingPortalSessionResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	origin, err := tenantorigin.Site(tenant)
	if errors.Is(err, tenantorigin.ErrDomainNotConfigured) {
		s.logger.WarnContext(ctx, "billing portal refused because tenant domain is not configured", "tenant_id", tenant.ID)
		return nil, connect.NewError(connect.CodeFailedPrecondition, err.Error()).WithCause(err)
	}
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the tenant site origin", err, "tenant_id", tenant.ID.String())
	}
	subscriptions, credentials, err := s.loadSubscriptionProvider(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	customerID, err := s.queriesFor(ctx).GetLatestStripeCustomerIDForUser(ctx, dbmodels.GetLatestStripeCustomerIDForUserParams{
		TenantID: tenant.ID,
		UserID:   uuid.NullUUID{UUID: user.ID, Valid: true},
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the reader has never subscribed")
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the reader's Stripe customer", err, "tenant_id", tenant.ID.String())
	}
	returnURL := *origin
	returnURL.Path = "/my"
	portalURL, err := subscriptions.StartBillingPortal(ctx, credentials, paymentprovider.BillingPortalRequest{
		CustomerID: customerID,
		ReturnURL:  returnURL.String(),
	})
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to open a billing portal session with the payment provider", "error", err, "tenant_id", tenant.ID)
		return nil, connect.NewError(connect.CodeUnavailable, "failed to open the billing portal")
	}
	return &publirav1.CreateBillingPortalSessionResponse{Url: portalURL}, nil
}

// loadSubscriptionProvider answers the tenant's enabled payment provider as
// one that sells subscriptions, or failed_precondition when it takes no
// payments or sells none.
func (s *apiServer) loadSubscriptionProvider(ctx context.Context, tenantID uuid.UUID) (paymentprovider.Subscriptions, paymentprovider.Credentials, error) {
	provider, _, credentials, err := s.loadPaymentProvider(ctx, tenantID)
	if err != nil {
		return nil, nil, err
	}
	subscriptions, ok := provider.(paymentprovider.Subscriptions)
	if !ok {
		return nil, nil, connect.NewError(connect.CodeFailedPrecondition, "the tenant's payment provider sells no subscriptions")
	}
	return subscriptions, credentials, nil
}

// subscriptionPlanTargets reads the labels and series the plans open.
func (s *apiServer) subscriptionPlanTargets(ctx context.Context, tenantID uuid.UUID, planIDs []uuid.UUID) (map[uuid.UUID]subscriptionPlanTargets, error) {
	targets := make(map[uuid.UUID]subscriptionPlanTargets, len(planIDs))
	if len(planIDs) == 0 {
		return targets, nil
	}
	rows, err := s.queriesFor(ctx).ListSubscriptionPlanTargetsForTenant(ctx, dbmodels.ListSubscriptionPlanTargetsForTenantParams{
		TenantID: tenantID,
		PlanIds:  planIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list subscription plan targets", err, "tenant_id", tenantID.String())
	}
	for _, row := range rows {
		target := targets[row.PlanID]
		if row.LabelID.Valid {
			target.labelIDs = append(target.labelIDs, row.LabelID.UUID.String())
		}
		if row.SeriesID.Valid {
			target.seriesIDs = append(target.seriesIDs, row.SeriesID.UUID.String())
		}
		targets[row.PlanID] = target
	}
	return targets, nil
}

func subscriptionPlanMessage(plan subscriptionPlanFields, targets subscriptionPlanTargets) (*publirav1.SubscriptionPlan, error) {
	scope, err := protomapper.SubscriptionPlanScopeFromStored(plan.scope)
	if err != nil {
		return nil, err
	}
	interval, err := protomapper.SubscriptionIntervalFromStored(plan.recurringInterval)
	if err != nil {
		return nil, err
	}
	return &publirav1.SubscriptionPlan{
		Id:            plan.id.String(),
		PublicId:      plan.publicID,
		Name:          plan.name,
		Description:   plan.description,
		PriceAmount:   plan.priceAmount,
		Currency:      plan.currency,
		Interval:      interval,
		IntervalCount: plan.recurringIntervalCount,
		Scope:         scope,
		LabelIds:      targets.labelIDs,
		SeriesIds:     targets.seriesIDs,
	}, nil
}

// recordSubscription writes the subscription a notification names as the
// provider holds it now. The read and the write happen under the
// subscription's lock, so of two deliveries that overlap, the one that writes
// last is also the one that read last, and a state Stripe has moved past is
// never written over the newer one.
//
// The plan it is recorded on is the one it is already recorded on, or for one
// not recorded yet the one its checkout named, while it is billed at the Price
// that plan was recorded or checked out at; else the one billed at the Price
// the provider reports; else that same recorded or checked-out plan. A
// subscription to none of them — a
// checkout started for a plan deleted before it completed — is logged and
// acknowledged, since no delivery of the same notification would find one.
func (s *apiServer) recordSubscription(
	ctx context.Context,
	tenantID uuid.UUID,
	provider paymentprovider.Provider,
	credentials paymentprovider.Credentials,
	event paymentprovider.SubscriptionChanged,
) error {
	subscriptions, ok := provider.(paymentprovider.Subscriptions)
	if !ok {
		return s.internalError(ctx, "a payment provider that sells no subscriptions reported one", errors.New("provider does not implement paymentprovider.Subscriptions"), "tenant_id", tenantID.String(), "event_id", event.ID)
	}
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return s.internalDBError(ctx, "failed to begin the subscription transaction", err, "event_id", event.ID)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	if err := queries.LockSubscriptionForTenant(ctx, dbmodels.LockSubscriptionForTenantParams{TenantID: tenantID, StripeSubscriptionID: event.SubscriptionID}); err != nil {
		return s.internalDBError(ctx, "failed to lock a subscription", err, "event_id", event.ID, "subscription_id", event.SubscriptionID)
	}
	subscription, err := subscriptions.RetrieveSubscription(ctx, credentials, event.SubscriptionID)
	if errors.Is(err, paymentprovider.ErrSubscriptionNotFound) {
		s.logger.WarnContext(ctx, "a payment webhook names a subscription the provider does not hold", "tenant_id", tenantID, "event_id", event.ID, "subscription_id", event.SubscriptionID)
		return connect.NewError(connect.CodeInvalidArgument, "invalid payment webhook")
	}
	if err != nil {
		return s.internalError(ctx, "failed to read a subscription from the payment provider", err, "tenant_id", tenantID.String(), "event_id", event.ID, "subscription_id", event.SubscriptionID)
	}
	if subscription.TenantID != tenantID {
		return connect.NewError(connect.CodeInvalidArgument, "subscription tenant does not match webhook path")
	}
	planID, err := queries.GetSubscriptionPlanForSubscriptionForTenant(ctx, dbmodels.GetSubscriptionPlanForSubscriptionForTenantParams{
		TenantID:             tenantID,
		StripePriceID:        subscription.PriceID,
		StripeSubscriptionID: subscription.ID,
		CheckoutPlanID:       subscription.PlanID,
		CheckoutPriceID:      subscription.CheckoutPriceID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		s.logger.ErrorContext(ctx, "a subscription names no plan of the tenant and is not recorded",
			"tenant_id", tenantID,
			"event_id", event.ID,
			"subscription_id", subscription.ID,
			"subscription_plan_id", subscription.PlanID,
			"price_id", subscription.PriceID,
		)
		return nil
	}
	if err != nil {
		return s.internalDBError(ctx, "failed to find the plan of a subscription", err, "event_id", event.ID, "subscription_id", subscription.ID)
	}
	var currentPeriodEnd sql.NullTime
	if !subscription.CurrentPeriodEnd.IsZero() {
		currentPeriodEnd = sql.NullTime{Time: subscription.CurrentPeriodEnd, Valid: true}
	}
	recorded, err := queries.RecordSubscriptionFromStripe(ctx, dbmodels.RecordSubscriptionFromStripeParams{
		ID:                   uuid.Must(uuid.NewV7()),
		TenantID:             tenantID,
		UserID:               subscription.ReaderID,
		PlanID:               planID,
		StripeCustomerID:     subscription.CustomerID,
		StripeSubscriptionID: subscription.ID,
		StripePriceID:        subscription.PriceID,
		Status:               string(subscription.Status),
		CurrentPeriodEnd:     currentPeriodEnd,
		CancelAtPeriodEnd:    subscription.CancelAtPeriodEnd,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to record a subscription", err, "event_id", event.ID, "subscription_id", subscription.ID)
	}
	if err := tx.Commit(); err != nil {
		return s.internalDBError(ctx, "failed to commit a subscription", err, "event_id", event.ID, "subscription_id", subscription.ID)
	}
	s.logger.InfoContext(ctx, "recorded a subscription",
		"tenant_id", tenantID,
		"event_id", event.ID,
		"subscription_id", recorded.ID,
		"subscription_plan_id", recorded.PlanID,
		"status", recorded.Status,
	)
	return nil
}
