package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

const (
	// maxInvoiceLegalNameLength bounds the name a receipt prints in its
	// issuer line, in characters.
	maxInvoiceLegalNameLength = 200
	// maxInvoiceRegistrationNumberLength bounds the registration number. A
	// number under the qualified invoice system is T and 13 digits; the bound
	// leaves room for another country's scheme without accepting prose.
	maxInvoiceRegistrationNumberLength = 32
)

// tenantTaxSettingsRevalidateTags names the public caches that carry the
// settings: the tenant read, which answers the rate and the invoice details a
// storefront states beside its prices and on its purchase history.
func tenantTaxSettingsRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:site", strings.TrimSpace(tenantID))}
}

// normalizeBasisPoints reads an optional rate, which is 1 through 10000 basis
// points where it is set.
func normalizeBasisPoints(value *int32) (sql.NullInt32, error) {
	if value == nil {
		return sql.NullInt32{}, nil
	}
	if *value < 1 || *value > 10000 {
		return sql.NullInt32{}, errors.New("rate must be 1 through 10000 basis points")
	}
	return sql.NullInt32{Int32: *value, Valid: true}, nil
}

// normalizeInvoiceLegalName trims the name and answers NULL for an empty one.
func normalizeInvoiceLegalName(value string) (sql.NullString, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullString{}, nil
	}
	if utf8.RuneCountInString(trimmed) > maxInvoiceLegalNameLength {
		return sql.NullString{}, fmt.Errorf("legal name must be at most %d characters", maxInvoiceLegalNameLength)
	}
	if strings.IndexFunc(trimmed, unicode.IsControl) >= 0 {
		return sql.NullString{}, errors.New("legal name must not contain a control character")
	}
	return sql.NullString{String: trimmed, Valid: true}, nil
}

// normalizeInvoiceRegistrationNumber trims the number and answers NULL for an
// empty one. It is an identifier a reader copies off a receipt, so it carries
// no whitespace.
func normalizeInvoiceRegistrationNumber(value string) (sql.NullString, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullString{}, nil
	}
	if utf8.RuneCountInString(trimmed) > maxInvoiceRegistrationNumberLength {
		return sql.NullString{}, fmt.Errorf("registration number must be at most %d characters", maxInvoiceRegistrationNumberLength)
	}
	if strings.IndexFunc(trimmed, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		return sql.NullString{}, errors.New("registration number must not contain whitespace or a control character")
	}
	return sql.NullString{String: trimmed, Valid: true}, nil
}

// currentTenantTaxRate reads the change of rate in effect now, and reports
// whether the tenant has ever set one.
func currentTenantTaxRate(ctx context.Context, queries dbmodels.Querier, tenantID uuid.UUID) (dbmodels.GetCurrentTenantTaxRateRow, bool, error) {
	row, err := queries.GetCurrentTenantTaxRate(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.GetCurrentTenantTaxRateRow{}, false, nil
	}
	if err != nil {
		return dbmodels.GetCurrentTenantTaxRateRow{}, false, err
	}
	return row, true, nil
}

func tenantTaxSettingsToProto(config dbmodels.TenantConfig, rate dbmodels.GetCurrentTenantTaxRateRow, hasRate bool) *publiraadminv1.TenantTaxSettings {
	settings := &publiraadminv1.TenantTaxSettings{
		WithholdingRateBps:        optional(config.WithholdingRateBps),
		InvoiceLegalName:          config.InvoiceLegalName.String,
		InvoiceRegistrationNumber: config.InvoiceRegistrationNumber.String,
	}
	if hasRate {
		settings.TaxRate = &publiraadminv1.TenantTaxRate{
			RateBps:     optional(rate.RateBps),
			AppliesFrom: rate.AppliesFrom.UTC().Format(time.RFC3339Nano),
		}
	}
	return settings
}

func (s *adminServer) GetTenantTaxSettings(
	ctx context.Context,
	req *publiraadminv1.GetTenantTaxSettingsRequest,
) (*publiraadminv1.GetTenantTaxSettingsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	config, err := queries.GetTenantConfigByTenantID(ctx, tenant.ID)
	if errors.Is(err, sql.ErrNoRows) {
		config = tenantConfigColumnDefaults(tenant.ID)
	} else if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant tax settings", err, "tenant_id", tenant.ID.String())
	}
	rate, hasRate, err := currentTenantTaxRate(ctx, queries, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant tax rate", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetTenantTaxSettingsResponse{
		Settings: tenantTaxSettingsToProto(config, rate, hasRate),
	}, nil
}

// UpdateTenantTaxSettings writes the card as a whole. A rate other than the
// one in effect is recorded as a change applying from now, so the purchases
// already made keep the rate they recorded; the other three are columns of
// the tenant's config row.
func (s *adminServer) UpdateTenantTaxSettings(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantTaxSettingsRequest,
) (*publiraadminv1.UpdateTenantTaxSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	taxRate, err := normalizeBasisPoints(req.TaxRateBps)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "tax_rate_bps")
	}
	withholdingRate, err := normalizeBasisPoints(req.WithholdingRateBps)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "withholding_rate_bps")
	}
	legalName, err := normalizeInvoiceLegalName(req.GetInvoiceLegalName())
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "invoice_legal_name")
	}
	registrationNumber, err := normalizeInvoiceRegistrationNumber(req.GetInvoiceRegistrationNumber())
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "invoice_registration_number")
	}

	var (
		updated dbmodels.TenantConfig
		rate    dbmodels.GetCurrentTenantTaxRateRow
		hasRate bool
	)
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		current, err := s.lockTenantConfig(txCtx, tenant.ID)
		if err != nil {
			return nil, err
		}
		queries := s.queriesFor(txCtx)
		rate, hasRate, err = currentTenantTaxRate(txCtx, queries, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to get tenant tax rate", err, "tenant_id", tenant.ID.String())
		}

		// A tenant that never set a rate and still sets none has nothing to
		// record; otherwise only a rate other than the one in effect does.
		rateChanged := rate.RateBps != taxRate && (hasRate || taxRate.Valid)
		configChanged := current.WithholdingRateBps != withholdingRate ||
			current.InvoiceLegalName != legalName ||
			current.InvoiceRegistrationNumber != registrationNumber
		updated = current
		if !rateChanged && !configChanged {
			return nil, nil
		}

		if rateChanged {
			inserted, err := queries.InsertTenantTaxRate(txCtx, dbmodels.InsertTenantTaxRateParams{
				TenantID: tenant.ID,
				RateBps:  taxRate,
			})
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to record tenant tax rate", err, "tenant_id", tenant.ID.String())
			}
			rate = dbmodels.GetCurrentTenantTaxRateRow(inserted)
			hasRate = true
		}
		if configChanged {
			updated, err = queries.UpsertTenantInvoiceSettings(txCtx, dbmodels.UpsertTenantInvoiceSettingsParams{
				TenantID:                  tenant.ID,
				InvoiceLegalName:          legalName,
				InvoiceRegistrationNumber: registrationNumber,
				WithholdingRateBps:        withholdingRate,
			})
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to update tenant invoice settings", err, "tenant_id", tenant.ID.String())
			}
		}
		if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_tax_settings_updated", "tenant_tax_settings"); err != nil {
			return nil, err
		}
		return tenantTaxSettingsRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	return &publiraadminv1.UpdateTenantTaxSettingsResponse{
		Settings: tenantTaxSettingsToProto(updated, rate, hasRate),
	}, nil
}
