package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"connectrpc.com/connect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// The identifier patterns are the app manifest's (mobile/config/app.schema.json),
// so a value copied from the manifest the app was built with is accepted.
var (
	androidApplicationIDPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$`)
	iosBundleIdentifierPattern  = regexp.MustCompile(`^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$`)
	sha256FingerprintPattern    = regexp.MustCompile(`^[0-9A-F]{2}(:[0-9A-F]{2}){31}$`)
	appleTeamIDPattern          = regexp.MustCompile(`^[A-Z0-9]{10}$`)
)

// maxAndroidCertFingerprints bounds how many signing certificates one request
// may store.
const maxAndroidCertFingerprints = 10

// normalizedAndroidAssociation is an Android identity ready to store: a NULL
// application ID and an empty, non-nil list where the tenant has no app, since
// pq sends a nil slice as NULL and the column is NOT NULL.
type normalizedAndroidAssociation struct {
	applicationID sql.NullString
	fingerprints  []string
}

func normalizeAndroidAssociation(android *publiraadminv1.TenantAndroidAppAssociation) (normalizedAndroidAssociation, error) {
	if android == nil {
		return normalizedAndroidAssociation{fingerprints: []string{}}, nil
	}
	applicationID := strings.TrimSpace(android.GetApplicationId())
	if !androidApplicationIDPattern.MatchString(applicationID) {
		return normalizedAndroidAssociation{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument,
			errors.New("application ID must be two or more dot-separated segments of letters, digits, and underscores, each starting with a letter"),
			"association.android.application_id")
	}

	raw := android.GetSha256CertFingerprints()
	if len(raw) == 0 || len(raw) > maxAndroidCertFingerprints {
		return normalizedAndroidAssociation{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument,
			fmt.Errorf("from 1 to %d certificate fingerprints are required", maxAndroidCertFingerprints),
			"association.android.sha256_cert_fingerprints")
	}
	fingerprints := make([]string, 0, len(raw))
	seen := make(map[string]struct{}, len(raw))
	for i, value := range raw {
		field := fmt.Sprintf("association.android.sha256_cert_fingerprints[%d]", i)
		fingerprint := strings.ToUpper(strings.TrimSpace(value))
		if !sha256FingerprintPattern.MatchString(fingerprint) {
			return normalizedAndroidAssociation{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument,
				errors.New("certificate fingerprint must be 32 colon-separated hex bytes"), field)
		}
		if _, ok := seen[fingerprint]; ok {
			return normalizedAndroidAssociation{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument,
				errors.New("certificate fingerprint is listed twice"), field)
		}
		seen[fingerprint] = struct{}{}
		fingerprints = append(fingerprints, fingerprint)
	}
	return normalizedAndroidAssociation{
		applicationID: sql.NullString{String: applicationID, Valid: true},
		fingerprints:  fingerprints,
	}, nil
}

func normalizeIosAssociation(ios *publiraadminv1.TenantIosAppAssociation) (teamID, bundleIdentifier sql.NullString, err error) {
	if ios == nil {
		return sql.NullString{}, sql.NullString{}, nil
	}
	team := strings.ToUpper(strings.TrimSpace(ios.GetTeamId()))
	if !appleTeamIDPattern.MatchString(team) {
		return sql.NullString{}, sql.NullString{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument,
			errors.New("team ID must be ten letters and digits"), "association.ios.team_id")
	}
	bundle := strings.TrimSpace(ios.GetBundleIdentifier())
	if !iosBundleIdentifierPattern.MatchString(bundle) {
		return sql.NullString{}, sql.NullString{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument,
			errors.New("bundle identifier must be two or more dot-separated segments of letters, digits, and hyphens"),
			"association.ios.bundle_identifier")
	}
	return sql.NullString{String: team, Valid: true}, sql.NullString{String: bundle, Valid: true}, nil
}

func tenantMobileAppAssociationFromConfig(config dbmodels.TenantConfig) *publiraadminv1.TenantMobileAppAssociation {
	association := &publiraadminv1.TenantMobileAppAssociation{}
	if config.AndroidApplicationID.Valid {
		association.Android = &publiraadminv1.TenantAndroidAppAssociation{
			ApplicationId:          config.AndroidApplicationID.String,
			Sha256CertFingerprints: config.AndroidSha256CertFingerprints,
		}
	}
	if config.IosTeamID.Valid {
		association.Ios = &publiraadminv1.TenantIosAppAssociation{
			TeamId:           config.IosTeamID.String,
			BundleIdentifier: config.IosBundleIdentifier.String,
		}
	}
	return association
}

func (s *adminServer) GetTenantMobileAppAssociation(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantMobileAppAssociationRequest],
) (*connect.Response[publiraadminv1.GetTenantMobileAppAssociationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// A tenant with no config row has no app on either platform.
			return connect.NewResponse(&publiraadminv1.GetTenantMobileAppAssociationResponse{
				Association: &publiraadminv1.TenantMobileAppAssociation{},
			}), nil
		}
		return nil, s.internalDBError(ctx, "failed to get tenant mobile app association", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetTenantMobileAppAssociationResponse{
		Association: tenantMobileAppAssociationFromConfig(config),
	}), nil
}

func (s *adminServer) UpdateTenantMobileAppAssociation(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantMobileAppAssociationRequest],
) (*connect.Response[publiraadminv1.UpdateTenantMobileAppAssociationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	requested := req.Msg.GetAssociation()
	android, err := normalizeAndroidAssociation(requested.GetAndroid())
	if err != nil {
		return nil, err
	}
	teamID, bundleIdentifier, err := normalizeIosAssociation(requested.GetIos())
	if err != nil {
		return nil, err
	}

	updated, err := s.queriesFor(ctx).UpsertTenantMobileAppAssociation(ctx, dbmodels.UpsertTenantMobileAppAssociationParams{
		TenantID:                      tenant.ID,
		AndroidApplicationID:          android.applicationID,
		AndroidSha256CertFingerprints: android.fingerprints,
		IosTeamID:                     teamID,
		IosBundleIdentifier:           bundleIdentifier,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update tenant mobile app association", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.UpdateTenantMobileAppAssociationResponse{
		Association: tenantMobileAppAssociationFromConfig(updated),
	}), nil
}
