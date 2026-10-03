package adminapi

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrejection"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

func tenantEmailRejectionSettingsToProto(settings emailrejection.Settings) *publiraadminv1.TenantEmailRejectionSettings {
	entries := settings.Entries
	if entries == nil {
		entries = []string{}
	}
	return &publiraadminv1.TenantEmailRejectionSettings{
		RejectDisposableDomains: settings.RejectDisposableDomains,
		Entries:                 entries,
	}
}

// disposableDomainListAvailable answers whether the platform policy names a
// disposable-domain list, which is what the tenant's switch refuses against.
func (s *adminServer) disposableDomainListAvailable(ctx context.Context) (bool, error) {
	policy, _, err := platformpolicy.Read(ctx, s.queriesFor(ctx))
	if err != nil {
		return false, s.internalDBError(ctx, "failed to read platform policy", err)
	}
	return policy.DisposableEmailDomainsURL != "", nil
}

func (s *adminServer) GetTenantEmailRejectionSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantEmailRejectionSettingsRequest],
) (*connect.Response[publiraadminv1.GetTenantEmailRejectionSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	settings, err := emailrejection.Get(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant email rejection settings", err, "tenant_id", tenant.ID.String())
	}
	available, err := s.disposableDomainListAvailable(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.GetTenantEmailRejectionSettingsResponse{
		Settings:                      tenantEmailRejectionSettingsToProto(settings),
		DisposableDomainListAvailable: available,
	}), nil
}

func (s *adminServer) UpdateTenantEmailRejectionSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantEmailRejectionSettingsRequest],
) (*connect.Response[publiraadminv1.UpdateTenantEmailRejectionSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if req.Msg.Settings == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("settings is required"))
	}
	input := emailrejection.Settings{
		RejectDisposableDomains: req.Msg.Settings.GetRejectDisposableDomains(),
		Entries:                 req.Msg.Settings.GetEntries(),
	}
	// Validated before the transaction, so a list with a typo costs no write.
	if _, err := emailrejection.NormalizeEntries(input.Entries); err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.entries")
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant email rejection settings transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	settings, err := emailrejection.Update(ctx, txq, tenant.ID, input)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update tenant email rejection settings", err, "tenant_id", tenant.ID.String())
	}
	if err := auditlog.WriteTenant(ctx, txq, s.logger, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: session.User.ID,
		ActorRole:   session.Role,
		Action:      emailrejection.ActionSettingsUpdated,
		TargetType:  "tenant_email_rejection_settings",
		TargetID:    tenant.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      emailRejectionSettingsAuditReason(settings),
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to audit tenant email rejection settings", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant email rejection settings", err, "tenant_id", tenant.ID.String())
	}

	available, err := s.disposableDomainListAvailable(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.UpdateTenantEmailRejectionSettingsResponse{
		Settings:                      tenantEmailRejectionSettingsToProto(settings),
		DisposableDomainListAvailable: available,
	}), nil
}

// emailRejectionSettingsAuditReason names the switch and how long the list
// is, and never an entry: an address a tenant refuses is a reader's address.
func emailRejectionSettingsAuditReason(settings emailrejection.Settings) string {
	return fmt.Sprintf("reject_disposable_domains=%t, entries=%d", settings.RejectDisposableDomains, len(settings.Entries))
}
