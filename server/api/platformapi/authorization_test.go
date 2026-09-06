package platformapi

import (
	"context"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
)

func TestEnsurePlatformWriteRole(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name    string
		role    string
		wantErr bool
	}{
		{name: "auditor", role: auth.RolePlatformAuditor, wantErr: true},
		{name: "operator", role: auth.RolePlatformOperator},
		{name: "super admin", role: auth.RolePlatformSuperAdmin},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ensurePlatformWriteRole(tc.role)
			if tc.wantErr {
				if got := connect.CodeOf(err); got != connect.CodePermissionDenied {
					t.Fatalf("ensurePlatformWriteRole(%q) code = %v, want permission_denied", tc.role, got)
				}
			} else if err != nil {
				t.Fatalf("ensurePlatformWriteRole(%q): %v", tc.role, err)
			}
		})
	}
}

func TestPlatformWriteProcedures(t *testing.T) {
	t.Parallel()

	want := map[string]struct{}{
		publirasplatformv1connect.PlatformEmailSettingsServiceUpdatePlatformEmailSettingsProcedure: {},
		publirasplatformv1connect.PlatformEmailSettingsServiceSendPlatformSmtpTestEmailProcedure:   {},
		publirasplatformv1connect.PlatformSettingsServiceUpdatePlatformSettingsProcedure:           {},
		publirasplatformv1connect.PlatformTenantServiceCreateTenantProcedure:                       {},
		publirasplatformv1connect.PlatformTenantServiceUpdateTenantProcedure:                       {},
		publirasplatformv1connect.PlatformTenantServiceSuspendTenantProcedure:                      {},
		publirasplatformv1connect.PlatformTenantServiceResumeTenantProcedure:                       {},
		publirasplatformv1connect.PlatformTenantServiceAddTenantMemberProcedure:                    {},
		publirasplatformv1connect.PlatformTenantServiceUpdateTenantMemberRoleProcedure:             {},
		publirasplatformv1connect.PlatformTenantServiceRemoveTenantMemberProcedure:                 {},
		publirasplatformv1connect.PlatformTenantServiceCreateTenantAdminInvitationProcedure:        {},
		publirasplatformv1connect.PlatformTenantServiceResendTenantAdminInvitationProcedure:        {},
		publirasplatformv1connect.PlatformTenantServiceCancelTenantAdminInvitationProcedure:        {},
		publirasplatformv1connect.PlatformUserServiceSuspendEndUserProcedure:                       {},
		publirasplatformv1connect.PlatformUserServiceUnsuspendEndUserProcedure:                     {},
		publirasplatformv1connect.PlatformUserServiceDeleteEndUserProcedure:                        {},
		publirasplatformv1connect.PlatformOperatorServiceCreateOperatorProcedure:                   {},
		publirasplatformv1connect.PlatformOperatorServiceUpdateOperatorRoleProcedure:               {},
		publirasplatformv1connect.PlatformOperatorServiceSuspendOperatorProcedure:                  {},
		publirasplatformv1connect.PlatformOperatorServiceUnsuspendOperatorProcedure:                {},
		publirasplatformv1connect.PlatformOperatorServiceDeactivateOperatorProcedure:               {},
	}

	if len(platformWriteProcedures) != len(want) {
		t.Fatalf("len(platformWriteProcedures) = %d, want %d", len(platformWriteProcedures), len(want))
	}
	for procedure := range want {
		if !isPlatformWriteProcedure(procedure) {
			t.Errorf("write procedure %q is not protected", procedure)
		}
	}
}

func TestPlatformAuditorCannotWriteBeforeSideEffects(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	expectIntegrationAuth(mock, uuid.Nil, uuid.Must(uuid.NewV7()), auth.RolePlatformAuditor, now)

	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdatePlatformSettings(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "Asia/Tokyo",
	}))
	if got := connect.CodeOf(err); got != connect.CodePermissionDenied {
		t.Fatalf("UpdatePlatformSettings code = %v, want permission_denied (err=%v)", got, err)
	}
	assertIntegrationExpectations(t, mock)
}

func TestPlatformAuditorCanReadPlatformSettings(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	expectIntegrationAuth(mock, uuid.Nil, uuid.Must(uuid.NewV7()), auth.RolePlatformAuditor, now)
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformConfigQuery)).
		WillReturnRows(platformConfigRow("Asia/Tokyo", "ja", 1, now))

	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetPlatformSettings(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if got := resp.Msg.GetSettings().GetDefaultTimezone(); got != "Asia/Tokyo" {
		t.Fatalf("default_timezone = %q, want Asia/Tokyo", got)
	}
	if got := resp.Msg.GetSettings().GetDefaultLocale(); got != "ja" {
		t.Fatalf("default_locale = %q, want ja", got)
	}
	assertIntegrationExpectations(t, mock)
}
