package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/paymentsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantwebhooks"
)

const (
	defaultWebhookDeliveryPageSize = int32(20)
	maxWebhookDeliveryPageSize     = int32(100)

	auditTargetWebhookEndpoint = "webhook_endpoint"
	auditTargetWebhookDelivery = "webhook_delivery"
)

var webhookEventTypes = map[publiraadminv1.WebhookEventType]string{
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_PURCHASE_COMPLETED:   tenantwebhooks.EventPurchaseCompleted,
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_PURCHASE_REFUNDED:    tenantwebhooks.EventPurchaseRefunded,
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_READER_SIGNED_UP:     tenantwebhooks.EventReaderSignedUp,
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_SUBSCRIPTION_STARTED: tenantwebhooks.EventSubscriptionStarted,
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_SUBSCRIPTION_ENDED:   tenantwebhooks.EventSubscriptionEnded,
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_EPISODE_PUBLISHED:    tenantwebhooks.EventEpisodePublished,
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_EPISODE_UNPUBLISHED:  tenantwebhooks.EventEpisodeUnpublished,
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_COMMENT_POSTED:       tenantwebhooks.EventCommentPosted,
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_TEST:                 tenantwebhooks.EventTest,
}

var webhookDeliveryStatuses = map[publiraadminv1.WebhookDeliveryStatus]string{
	publiraadminv1.WebhookDeliveryStatus_WEBHOOK_DELIVERY_STATUS_PENDING:   tenantwebhooks.StatusPending,
	publiraadminv1.WebhookDeliveryStatus_WEBHOOK_DELIVERY_STATUS_FAILED:    tenantwebhooks.StatusFailed,
	publiraadminv1.WebhookDeliveryStatus_WEBHOOK_DELIVERY_STATUS_DELIVERED: tenantwebhooks.StatusDelivered,
	publiraadminv1.WebhookDeliveryStatus_WEBHOOK_DELIVERY_STATUS_DEAD:      tenantwebhooks.StatusDead,
}

func webhookEndpointToProto(row dbmodels.TenantWebhookEndpoint) *publiraadminv1.WebhookEndpoint {
	events := make([]publiraadminv1.WebhookEventType, 0, len(row.EventTypes))
	for _, event := range row.EventTypes {
		events = append(events, storedKindToProto(webhookEventTypes, event))
	}
	return &publiraadminv1.WebhookEndpoint{
		Id:         row.ID.String(),
		Url:        row.Url,
		EventTypes: events,
		Enabled:    row.Enabled,
		SecretHint: row.SecretHint,
		CreatedAt:  row.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:  row.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func webhookDeliveryToProto(row dbmodels.ListWebhookDeliveriesDescRow) *publiraadminv1.WebhookDelivery {
	return &publiraadminv1.WebhookDelivery{
		Id:             row.ID.String(),
		EndpointId:     row.EndpointID.String(),
		EndpointUrl:    row.EndpointUrl,
		EventType:      storedKindToProto(webhookEventTypes, row.EventType),
		EventId:        row.EventID,
		Status:         storedKindToProto(webhookDeliveryStatuses, row.Status),
		Attempts:       row.Attempts,
		LastStatusCode: row.LastStatusCode.Int32,
		LastError:      row.LastError.String,
		DeliveredAt:    formatOptionalTime(row.DeliveredAt),
		CreatedAt:      row.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:      row.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// webhookEndpointInput is an endpoint's URL and events, read and checked from
// a request.
type webhookEndpointInput struct {
	url        string
	eventTypes []string
	enabled    bool
}

func readWebhookEndpointInput(rawURL string, events []publiraadminv1.WebhookEventType, enabled bool) (webhookEndpointInput, error) {
	url, err := tenantwebhooks.ValidateURL(rawURL)
	if err != nil {
		return webhookEndpointInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "url")
	}
	eventTypes := make([]string, 0, len(events))
	for _, event := range events {
		name, ok := webhookEventTypes[event]
		if !ok || !tenantwebhooks.Subscribable(name) {
			return webhookEndpointInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("names an event an endpoint cannot subscribe to"), "event_types")
		}
		if !slices.Contains(eventTypes, name) {
			eventTypes = append(eventTypes, name)
		}
	}
	if len(eventTypes) == 0 {
		return webhookEndpointInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("must name at least one event"), "event_types")
	}
	// Stored in the order the events are listed, so a save that names the same
	// events in another order changes nothing.
	slices.SortFunc(eventTypes, func(a, b string) int {
		return slices.Index(tenantwebhooks.EventTypes, a) - slices.Index(tenantwebhooks.EventTypes, b)
	})
	return webhookEndpointInput{url: url, eventTypes: eventTypes, enabled: enabled}, nil
}

func (in webhookEndpointInput) equal(row dbmodels.TenantWebhookEndpoint) bool {
	return in.url == row.Url && slices.Equal(in.eventTypes, row.EventTypes) && in.enabled == row.Enabled
}

// sealWebhookSecret makes an endpoint's signing secret and seals it.
func (s *adminServer) sealWebhookSecret(ctx context.Context, tenantID uuid.UUID) (secret, sealed, hint string, err error) {
	if s.encryptor == nil {
		return "", "", "", connect.NewError(connect.CodeFailedPrecondition, "webhook secret encryption is not configured")
	}
	if secret, err = tenantwebhooks.NewSecret(); err != nil {
		return "", "", "", s.internalError(ctx, "failed to generate a webhook secret", err, "tenant_id", tenantID.String())
	}
	if sealed, err = s.encryptor.EncryptString(secret); err != nil {
		return "", "", "", s.internalError(ctx, "failed to seal a webhook secret", err, "tenant_id", tenantID.String())
	}
	return secret, sealed, paymentsettings.MaskSecret(secret), nil
}

func (s *adminServer) ListWebhookEndpoints(
	ctx context.Context,
	req *publiraadminv1.ListWebhookEndpointsRequest,
) (*publiraadminv1.ListWebhookEndpointsResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListTenantWebhookEndpoints(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list webhook endpoints", err, "tenant_id", tenant.ID.String())
	}
	endpoints := make([]*publiraadminv1.WebhookEndpoint, 0, len(rows))
	for _, row := range rows {
		endpoints = append(endpoints, webhookEndpointToProto(row))
	}
	return &publiraadminv1.ListWebhookEndpointsResponse{Endpoints: endpoints}, nil
}

func (s *adminServer) CreateWebhookEndpoint(
	ctx context.Context,
	req *publiraadminv1.CreateWebhookEndpointRequest,
) (*publiraadminv1.CreateWebhookEndpointResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	input, err := readWebhookEndpointInput(req.Url, req.EventTypes, req.Enabled)
	if err != nil {
		return nil, err
	}
	secret, sealed, hint, err := s.sealWebhookSecret(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create webhook endpoint transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, queries)

	if err := queries.LockTenantWebhookEndpoints(txCtx, tenant.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock the tenant's webhook endpoints", err, "tenant_id", tenant.ID.String())
	}
	count, err := queries.CountTenantWebhookEndpoints(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count webhook endpoints", err, "tenant_id", tenant.ID.String())
	}
	if count >= tenantwebhooks.MaxEndpoints {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errors.New("the tenant keeps as many webhook endpoints as it may"), rpcerrors.ReasonWebhookEndpointLimit)
	}
	row, err := queries.CreateTenantWebhookEndpoint(txCtx, dbmodels.CreateTenantWebhookEndpointParams{
		ID:              uuid.Must(uuid.NewV7()),
		TenantID:        tenant.ID,
		Url:             input.url,
		SecretEncrypted: sealed,
		SecretHint:      hint,
		EventTypes:      input.eventTypes,
		Enabled:         input.enabled,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create webhook endpoint", err, "tenant_id", tenant.ID.String())
	}
	if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "webhook_endpoint_created", auditTargetWebhookEndpoint, row.ID.String()); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create webhook endpoint", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.CreateWebhookEndpointResponse{Endpoint: webhookEndpointToProto(row), Secret: secret}, nil
}

// changeWebhookEndpoint runs change on the endpoint a request names under its
// row lock. change reports the audit action of what it changed, or "" for a
// request that changed nothing, which records nothing.
func (s *adminServer) changeWebhookEndpoint(
	ctx context.Context,
	session rpcmiddleware.SessionContext,
	tenantContext *publirattypesv1.TenantContext,
	rawID string,
	change func(txCtx context.Context, queries *dbmodels.Queries, current dbmodels.TenantWebhookEndpoint) (dbmodels.TenantWebhookEndpoint, string, error),
) (dbmodels.TenantWebhookEndpoint, error) {
	tenant, err := s.tenantByContext(ctx, tenantContext)
	if err != nil {
		return dbmodels.TenantWebhookEndpoint{}, err
	}
	id, err := parseRecordID(rawID, "endpoint_id")
	if err != nil {
		return dbmodels.TenantWebhookEndpoint{}, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return dbmodels.TenantWebhookEndpoint{}, s.internalDBError(ctx, "failed to begin webhook endpoint transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, queries)

	current, err := queries.GetTenantWebhookEndpointForUpdate(txCtx, dbmodels.GetTenantWebhookEndpointForUpdateParams{TenantID: tenant.ID, ID: id})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.TenantWebhookEndpoint{}, connect.NewError(connect.CodeNotFound, "webhook endpoint not found")
	}
	if err != nil {
		return dbmodels.TenantWebhookEndpoint{}, s.internalDBError(ctx, "failed to get webhook endpoint", err, "tenant_id", tenant.ID.String())
	}
	changed, action, err := change(txCtx, queries, current)
	if err != nil {
		return dbmodels.TenantWebhookEndpoint{}, err
	}
	if action != "" {
		if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, action, auditTargetWebhookEndpoint, id.String()); err != nil {
			return dbmodels.TenantWebhookEndpoint{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.TenantWebhookEndpoint{}, s.internalDBError(ctx, "failed to commit webhook endpoint change", err, "tenant_id", tenant.ID.String())
	}
	return changed, nil
}

func (s *adminServer) UpdateWebhookEndpoint(
	ctx context.Context,
	req *publiraadminv1.UpdateWebhookEndpointRequest,
) (*publiraadminv1.UpdateWebhookEndpointResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	input, err := readWebhookEndpointInput(req.Url, req.EventTypes, req.Enabled)
	if err != nil {
		return nil, err
	}
	row, err := s.changeWebhookEndpoint(ctx, session, req.Tenant, req.EndpointId, func(txCtx context.Context, queries *dbmodels.Queries, current dbmodels.TenantWebhookEndpoint) (dbmodels.TenantWebhookEndpoint, string, error) {
		if input.equal(current) {
			return current, "", nil
		}
		updated, err := queries.UpdateTenantWebhookEndpoint(txCtx, dbmodels.UpdateTenantWebhookEndpointParams{
			TenantID:   current.TenantID,
			ID:         current.ID,
			Url:        input.url,
			EventTypes: input.eventTypes,
			Enabled:    input.enabled,
		})
		if err != nil {
			return current, "", s.internalDBError(txCtx, "failed to update webhook endpoint", err, "tenant_id", current.TenantID.String(), "endpoint_id", current.ID.String())
		}
		return updated, "webhook_endpoint_updated", nil
	})
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UpdateWebhookEndpointResponse{Endpoint: webhookEndpointToProto(row)}, nil
}

func (s *adminServer) RotateWebhookSecret(
	ctx context.Context,
	req *publiraadminv1.RotateWebhookSecretRequest,
) (*publiraadminv1.RotateWebhookSecretResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	var secret string
	row, err := s.changeWebhookEndpoint(ctx, session, req.Tenant, req.EndpointId, func(txCtx context.Context, queries *dbmodels.Queries, current dbmodels.TenantWebhookEndpoint) (dbmodels.TenantWebhookEndpoint, string, error) {
		made, sealed, hint, err := s.sealWebhookSecret(txCtx, current.TenantID)
		if err != nil {
			return current, "", err
		}
		rotated, err := queries.RotateTenantWebhookEndpointSecret(txCtx, dbmodels.RotateTenantWebhookEndpointSecretParams{
			TenantID:        current.TenantID,
			ID:              current.ID,
			SecretEncrypted: sealed,
			SecretHint:      hint,
		})
		if err != nil {
			return current, "", s.internalDBError(txCtx, "failed to rotate webhook secret", err, "tenant_id", current.TenantID.String(), "endpoint_id", current.ID.String())
		}
		secret = made
		return rotated, "webhook_secret_rotated", nil
	})
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.RotateWebhookSecretResponse{Endpoint: webhookEndpointToProto(row), Secret: secret}, nil
}

func (s *adminServer) DeleteWebhookEndpoint(
	ctx context.Context,
	req *publiraadminv1.DeleteWebhookEndpointRequest,
) (*publiraadminv1.DeleteWebhookEndpointResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.changeWebhookEndpoint(ctx, session, req.Tenant, req.EndpointId, func(txCtx context.Context, queries *dbmodels.Queries, current dbmodels.TenantWebhookEndpoint) (dbmodels.TenantWebhookEndpoint, string, error) {
		if _, err := queries.DeleteTenantWebhookEndpoint(txCtx, dbmodels.DeleteTenantWebhookEndpointParams{TenantID: current.TenantID, ID: current.ID}); err != nil {
			return current, "", s.internalDBError(txCtx, "failed to delete webhook endpoint", err, "tenant_id", current.TenantID.String(), "endpoint_id", current.ID.String())
		}
		return current, "webhook_endpoint_deleted", nil
	}); err != nil {
		return nil, err
	}
	return &publiraadminv1.DeleteWebhookEndpointResponse{}, nil
}

func (s *adminServer) SendTestWebhook(
	ctx context.Context,
	req *publiraadminv1.SendTestWebhookRequest,
) (*publiraadminv1.SendTestWebhookResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	endpointID, err := parseRecordID(req.EndpointId, "endpoint_id")
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin test webhook transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, queries)

	if _, err := queries.GetTenantWebhookEndpointForUpdate(txCtx, dbmodels.GetTenantWebhookEndpointForUpdateParams{TenantID: tenant.ID, ID: endpointID}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "webhook endpoint not found")
		}
		return nil, s.internalDBError(ctx, "failed to get webhook endpoint", err, "tenant_id", tenant.ID.String())
	}
	deliveryID, err := tenantwebhooks.QueueTest(txCtx, queries, tenant.ID, endpointID)
	if err != nil {
		return nil, s.internalError(ctx, "failed to queue a test webhook", err, "tenant_id", tenant.ID.String(), "endpoint_id", endpointID.String())
	}
	delivery, err := s.webhookDelivery(txCtx, queries, tenant.ID, deliveryID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit test webhook", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.SendTestWebhookResponse{Delivery: delivery}, nil
}

// webhookDelivery answers one delivery as ListWebhookDeliveries does.
func (s *adminServer) webhookDelivery(ctx context.Context, queries *dbmodels.Queries, tenantID, deliveryID uuid.UUID) (*publiraadminv1.WebhookDelivery, error) {
	row, err := queries.GetWebhookDelivery(ctx, dbmodels.GetWebhookDeliveryParams{TenantID: tenantID, ID: deliveryID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeNotFound, "webhook delivery not found")
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get webhook delivery", err, "tenant_id", tenantID.String())
	}
	return webhookDeliveryToProto(dbmodels.ListWebhookDeliveriesDescRow(row)), nil
}

func (s *adminServer) ListWebhookDeliveries(
	ctx context.Context,
	req *publiraadminv1.ListWebhookDeliveriesRequest,
) (*publiraadminv1.ListWebhookDeliveriesResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	var status sql.NullString
	if req.Status != publiraadminv1.WebhookDeliveryStatus_WEBHOOK_DELIVERY_STATUS_UNSPECIFIED {
		name, ok := webhookDeliveryStatuses[req.Status]
		if !ok {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("names a status that does not exist"), "status")
		}
		status = sql.NullString{String: name, Valid: true}
	}
	limit := pagination.NormalizeLimit(req.Limit, defaultWebhookDeliveryPageSize, maxWebhookDeliveryPageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	listKey := pagination.NewListKey("created_at_desc").Value("status", status.String)
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		if keys, err = listKey.DecodeTimeUUID(cursor); err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
		}
	}

	queries := s.queriesFor(ctx)
	params := dbmodels.ListWebhookDeliveriesDescParams{
		TenantID:        tenant.ID,
		Status:          status,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:           limit + 1,
	}
	var rows []dbmodels.ListWebhookDeliveriesDescRow
	if cursor.Direction == pagination.Backward {
		found, err := queries.ListWebhookDeliveriesAsc(ctx, dbmodels.ListWebhookDeliveriesAscParams(params))
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list webhook deliveries", err, "tenant_id", tenant.ID.String())
		}
		for _, row := range found {
			rows = append(rows, dbmodels.ListWebhookDeliveriesDescRow(row))
		}
	} else if rows, err = queries.ListWebhookDeliveriesDesc(ctx, params); err != nil {
		return nil, s.internalDBError(ctx, "failed to list webhook deliveries", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	deliveries := make([]*publiraadminv1.WebhookDelivery, 0, len(rows))
	for _, row := range rows {
		deliveries = append(deliveries, webhookDeliveryToProto(row))
	}
	res := &publiraadminv1.ListWebhookDeliveriesResponse{Deliveries: deliveries}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued — deleting an endpoint takes its deliveries with it. Hand back a
	// token to where the client came from, and only once.
	case cursor.Direction == pagination.Forward && keys.Valid && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && keys.Valid && !keys.Inclusive:
		res.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return res, nil
}

func (s *adminServer) ResendWebhookDelivery(
	ctx context.Context,
	req *publiraadminv1.ResendWebhookDeliveryRequest,
) (*publiraadminv1.ResendWebhookDeliveryResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.DeliveryId, "delivery_id")
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin resend webhook transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, queries)

	current, err := queries.GetWebhookDeliveryForUpdate(txCtx, dbmodels.GetWebhookDeliveryForUpdateParams{TenantID: tenant.ID, ID: id})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeNotFound, "webhook delivery not found")
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get webhook delivery", err, "tenant_id", tenant.ID.String())
	}
	if current.Status != tenantwebhooks.StatusDead {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "only a dead webhook delivery can be resent")
	}
	if err := queries.ResendWebhookDelivery(txCtx, dbmodels.ResendWebhookDeliveryParams{TenantID: tenant.ID, ID: id}); err != nil {
		return nil, s.internalDBError(ctx, "failed to resend webhook delivery", err, "tenant_id", tenant.ID.String())
	}
	if err := tenantwebhooks.QueueResend(txCtx, queries, tenant.ID, id); err != nil {
		return nil, s.internalError(ctx, "failed to queue a webhook resend", err, "tenant_id", tenant.ID.String(), "delivery_id", id.String())
	}
	if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "webhook_delivery_resent", auditTargetWebhookDelivery, id.String()); err != nil {
		return nil, err
	}
	delivery, err := s.webhookDelivery(txCtx, queries, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit resend webhook", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.ResendWebhookDeliveryResponse{Delivery: delivery}, nil
}
