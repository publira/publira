package adminapi

import (
	"context"
	"testing"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// What a tenant saved about commenting comes back as one card's worth of
// settings, and a tenant that has saved nothing is answered with what the
// columns themselves would have stored. These run against a real database, so
// the defaults compared here are the schema's own.

// A tenant with no config row is told the defaults the first save will write.
// Reporting anything else would put a number on the card that the very next
// save contradicts.
func TestDBTenantCommentSettingsDefaultsMatchTheColumnDefaults(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TCSTNNT1", "comment-settings.example.com", "Comment Settings", "TCSUSER1", "admin@comment-settings.example.com")

	reported, err := env.tenantSettingsClient().GetTenantCommentSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantCommentSettingsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantCommentSettings: %v", err)
	}
	if reported.Msg.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_DISABLED {
		t.Fatalf("comment_mode without a config row = %v, want COMMENT_MODE_DISABLED", reported.Msg.CommentMode)
	}

	if _, err := env.PG.DB.ExecContext(context.Background(),
		"INSERT INTO tenant_config (tenant_id) VALUES ($1)", tenant.Tenant.ID,
	); err != nil {
		t.Fatalf("insert a bare tenant_config row: %v", err)
	}
	stored := env.countRows(t,
		"SELECT comment_auto_hide_report_threshold FROM tenant_config WHERE tenant_id = $1",
		tenant.Tenant.ID,
	)
	if uint32(stored) != reported.Msg.AutoHideReportThreshold {
		t.Fatalf("stored column default = %d, but the console reports %d for a tenant with no row", stored, reported.Msg.AutoHideReportThreshold)
	}
}

// The card saves the mode and the threshold together, and reads back what was
// stored rather than what was sent.
func TestDBTenantCommentSettingsRoundTrip(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TCRTNNT1", "comment-roundtrip.example.com", "Comment Round Trip", "TCRUSER1", "admin@comment-roundtrip.example.com")
	settings := env.tenantSettingsClient()

	saved, err := settings.UpdateTenantCommentSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantCommentSettingsRequest{
		AutoHideReportThreshold: 5,
		CommentMode:             publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE,
		Tenant:                  tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("UpdateTenantCommentSettings: %v", err)
	}
	if saved.Msg.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE || saved.Msg.AutoHideReportThreshold != 5 {
		t.Fatalf("saved settings = %v/%d, want COMMENT_MODE_IMMEDIATE/5", saved.Msg.CommentMode, saved.Msg.AutoHideReportThreshold)
	}

	// The upsert wrote the tenant's first config row; saving again has to
	// change both columns of the row that now exists.
	if _, err := settings.UpdateTenantCommentSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantCommentSettingsRequest{
		AutoHideReportThreshold: 0,
		CommentMode:             publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED,
		Tenant:                  tenant.tenantContext(),
	})); err != nil {
		t.Fatalf("second UpdateTenantCommentSettings: %v", err)
	}

	read, err := settings.GetTenantCommentSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantCommentSettingsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantCommentSettings: %v", err)
	}
	if read.Msg.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED {
		t.Fatalf("comment_mode = %v, want COMMENT_MODE_APPROVAL_REQUIRED", read.Msg.CommentMode)
	}
	if read.Msg.AutoHideReportThreshold != 0 {
		t.Fatalf("auto_hide_report_threshold = %d, want the automatic removal turned off", read.Msg.AutoHideReportThreshold)
	}
}

// The age rule is saved the same way, and a tenant that has saved nothing is
// answered with the rule the column's own default carries.
func TestDBTenantAgeVerificationRoundTrip(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TAVTNNT1", "age-verification.example.com", "Age Verification", "TAVUSER1", "admin@age-verification.example.com")
	settings := env.tenantSettingsClient()

	reported, err := settings.GetTenantAgeVerification(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantAgeVerificationRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantAgeVerification: %v", err)
	}
	if reported.Msg.AgeVerification != publirattypesv1.AgeVerification_AGE_VERIFICATION_NONE {
		t.Fatalf("age_verification without a config row = %v, want AGE_VERIFICATION_NONE", reported.Msg.AgeVerification)
	}

	// The upsert writes the tenant's first config row, and saving again has to
	// change the row that now exists.
	for _, rule := range []publirattypesv1.AgeVerification{
		publirattypesv1.AgeVerification_AGE_VERIFICATION_R18,
		publirattypesv1.AgeVerification_AGE_VERIFICATION_R15_AND_R18,
		publirattypesv1.AgeVerification_AGE_VERIFICATION_NONE,
	} {
		saved, err := settings.UpdateTenantAgeVerification(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantAgeVerificationRequest{
			AgeVerification: rule,
			Tenant:          tenant.tenantContext(),
		}))
		if err != nil {
			t.Fatalf("UpdateTenantAgeVerification(%v): %v", rule, err)
		}
		if saved.Msg.AgeVerification != rule {
			t.Fatalf("saved age_verification = %v, want %v", saved.Msg.AgeVerification, rule)
		}

		read, err := settings.GetTenantAgeVerification(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantAgeVerificationRequest{
			Tenant: tenant.tenantContext(),
		}))
		if err != nil {
			t.Fatalf("GetTenantAgeVerification after saving %v: %v", rule, err)
		}
		if read.Msg.AgeVerification != rule {
			t.Fatalf("read age_verification = %v, want %v", read.Msg.AgeVerification, rule)
		}
	}
}
