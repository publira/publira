package adminapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
)

var errTenantCommunityLimitConflict = errors.New("community limit settings have changed since they were read")

func nullable(v *int32) sql.NullInt32 {
	if v == nil {
		return sql.NullInt32{}
	}
	return sql.NullInt32{Int32: *v, Valid: true}
}
func optional(v sql.NullInt32) *int32 {
	if !v.Valid {
		return nil
	}
	return new(v.Int32)
}
func minuteFromDB(a, b sql.NullInt32) *publiraplatformv1.MinuteDayLimit {
	if !a.Valid || !b.Valid {
		return nil
	}
	return &publiraplatformv1.MinuteDayLimit{PerMinute: a.Int32, PerDay: b.Int32}
}
func hourFromDB(a, b sql.NullInt32) *publiraplatformv1.HourDayLimit {
	if !a.Valid || !b.Valid {
		return nil
	}
	return &publiraplatformv1.HourDayLimit{PerHour: a.Int32, PerDay: b.Int32}
}
func minuteToDB(v *publiraplatformv1.MinuteDayLimit) (sql.NullInt32, sql.NullInt32) {
	if v == nil {
		return sql.NullInt32{}, sql.NullInt32{}
	}
	return nullable(&v.PerMinute), nullable(&v.PerDay)
}
func hourToDB(v *publiraplatformv1.HourDayLimit) (sql.NullInt32, sql.NullInt32) {
	if v == nil {
		return sql.NullInt32{}, sql.NullInt32{}
	}
	return nullable(&v.PerHour), nullable(&v.PerDay)
}

func communityOverridesFromRow(r dbmodels.TenantCommunityLimitOverride) *publiraadminv1.TenantCommunityLimitOverrides {
	return &publiraadminv1.TenantCommunityLimitOverrides{CommentPost: minuteFromDB(r.CommentPostLimitPerMinute, r.CommentPostLimitPerDay), CommentReport: minuteFromDB(r.CommentReportLimitPerMinute, r.CommentReportLimitPerDay), DuplicateCommentWindowMinutes: optional(r.CommentDuplicateWindowMinutes), EpisodeRating: minuteFromDB(r.EpisodeRatingLimitPerMinute, r.EpisodeRatingLimitPerDay), ContactMessagePerAccount: hourFromDB(r.ContactMessageLimitPerAccountPerHour, r.ContactMessageLimitPerAccountPerDay), ContactMessagePerClient: hourFromDB(r.ContactMessageLimitPerClientPerHour, r.ContactMessageLimitPerClientPerDay), ViewerPreferences: minuteFromDB(r.ViewerPreferencesLimitPerMinute, r.ViewerPreferencesLimitPerDay)}
}
func communityOverridesParams(tenantID uuid.UUID, v *publiraadminv1.TenantCommunityLimitOverrides) dbmodels.UpdateTenantCommunityLimitOverridesParams {
	cpMin, cpDay := minuteToDB(v.GetCommentPost())
	crMin, crDay := minuteToDB(v.GetCommentReport())
	erMin, erDay := minuteToDB(v.GetEpisodeRating())
	caHour, caDay := hourToDB(v.GetContactMessagePerAccount())
	ccHour, ccDay := hourToDB(v.GetContactMessagePerClient())
	vpMin, vpDay := minuteToDB(v.GetViewerPreferences())
	return dbmodels.UpdateTenantCommunityLimitOverridesParams{TenantID: tenantID, CommentPostLimitPerMinute: cpMin, CommentPostLimitPerDay: cpDay, CommentReportLimitPerMinute: crMin, CommentReportLimitPerDay: crDay, CommentDuplicateWindowMinutes: nullable(v.DuplicateCommentWindowMinutes), EpisodeRatingLimitPerMinute: erMin, EpisodeRatingLimitPerDay: erDay, ContactMessageLimitPerAccountPerHour: caHour, ContactMessageLimitPerAccountPerDay: caDay, ContactMessageLimitPerClientPerHour: ccHour, ContactMessageLimitPerClientPerDay: ccDay, ViewerPreferencesLimitPerMinute: vpMin, ViewerPreferencesLimitPerDay: vpDay}
}
func communityOverridesInsertParams(p dbmodels.UpdateTenantCommunityLimitOverridesParams) dbmodels.InsertTenantCommunityLimitOverridesParams {
	return dbmodels.InsertTenantCommunityLimitOverridesParams{TenantID: p.TenantID, CommentPostLimitPerMinute: p.CommentPostLimitPerMinute, CommentPostLimitPerDay: p.CommentPostLimitPerDay, CommentReportLimitPerMinute: p.CommentReportLimitPerMinute, CommentReportLimitPerDay: p.CommentReportLimitPerDay, CommentDuplicateWindowMinutes: p.CommentDuplicateWindowMinutes, EpisodeRatingLimitPerMinute: p.EpisodeRatingLimitPerMinute, EpisodeRatingLimitPerDay: p.EpisodeRatingLimitPerDay, ContactMessageLimitPerAccountPerHour: p.ContactMessageLimitPerAccountPerHour, ContactMessageLimitPerAccountPerDay: p.ContactMessageLimitPerAccountPerDay, ContactMessageLimitPerClientPerHour: p.ContactMessageLimitPerClientPerHour, ContactMessageLimitPerClientPerDay: p.ContactMessageLimitPerClientPerDay, ViewerPreferencesLimitPerMinute: p.ViewerPreferencesLimitPerMinute, ViewerPreferencesLimitPerDay: p.ViewerPreferencesLimitPerDay}
}
func communityDefaults(p platformpolicy.CommunityLimits) *publiraplatformv1.CommunityLimitDefaults {
	return &publiraplatformv1.CommunityLimitDefaults{CommentPost: &publiraplatformv1.MinuteDayLimit{PerMinute: int32(p.CommentPost.PerMinute), PerDay: int32(p.CommentPost.PerDay)}, CommentReport: &publiraplatformv1.MinuteDayLimit{PerMinute: int32(p.CommentReport.PerMinute), PerDay: int32(p.CommentReport.PerDay)}, DuplicateCommentWindowMinutes: int32(p.DuplicateCommentWindow.Minutes()), EpisodeRating: &publiraplatformv1.MinuteDayLimit{PerMinute: int32(p.EpisodeRating.PerMinute), PerDay: int32(p.EpisodeRating.PerDay)}, ContactMessagePerAccount: &publiraplatformv1.HourDayLimit{PerHour: int32(p.ContactMessagePerAccount.PerHour), PerDay: int32(p.ContactMessagePerAccount.PerDay)}, ContactMessagePerClient: &publiraplatformv1.HourDayLimit{PerHour: int32(p.ContactMessagePerClient.PerHour), PerDay: int32(p.ContactMessagePerClient.PerDay)}, ViewerPreferences: &publiraplatformv1.MinuteDayLimit{PerMinute: int32(p.ViewerPreferencesUpdate.PerMinute), PerDay: int32(p.ViewerPreferencesUpdate.PerDay)}}
}
func validateCommunityOverrides(v *publiraadminv1.TenantCommunityLimitOverrides, d *publiraplatformv1.CommunityLimitDefaults) error {
	minute := func(name string, got, max *publiraplatformv1.MinuteDayLimit) error {
		if got == nil {
			return nil
		}
		if got.PerMinute < 1 || got.PerDay < got.PerMinute {
			return errors.New(name + " must be a valid minute/day limit")
		}
		if got.PerMinute > max.PerMinute || got.PerDay > max.PerDay {
			return errors.New(name + " must not be looser than the platform policy")
		}
		return nil
	}
	hour := func(name string, got, max *publiraplatformv1.HourDayLimit) error {
		if got == nil {
			return nil
		}
		if got.PerHour < 1 || got.PerDay < got.PerHour {
			return errors.New(name + " must be a valid hour/day limit")
		}
		if got.PerHour > max.PerHour || got.PerDay > max.PerDay {
			return errors.New(name + " must not be looser than the platform policy")
		}
		return nil
	}
	for _, x := range []struct {
		name     string
		got, max *publiraplatformv1.MinuteDayLimit
	}{{"comment_post", v.CommentPost, d.CommentPost}, {"comment_report", v.CommentReport, d.CommentReport}, {"episode_rating", v.EpisodeRating, d.EpisodeRating}, {"viewer_preferences", v.ViewerPreferences, d.ViewerPreferences}} {
		if err := minute(x.name, x.got, x.max); err != nil {
			return err
		}
	}
	for _, x := range []struct {
		name     string
		got, max *publiraplatformv1.HourDayLimit
	}{{"contact_message_per_account", v.ContactMessagePerAccount, d.ContactMessagePerAccount}, {"contact_message_per_client", v.ContactMessagePerClient, d.ContactMessagePerClient}} {
		if err := hour(x.name, x.got, x.max); err != nil {
			return err
		}
	}
	if v.DuplicateCommentWindowMinutes != nil && (*v.DuplicateCommentWindowMinutes < d.DuplicateCommentWindowMinutes || *v.DuplicateCommentWindowMinutes > int32(platformpolicy.MaxDuplicateCommentWindow.Minutes())) {
		return errors.New("duplicate_comment_window_minutes must be at least the platform policy and at most one week")
	}
	return nil
}

// effectiveCommunityLimits is deliberately defensive as well as the update
// validation: a platform change made after a tenant save must still bound an
// older row that was valid when it was written.
func effectiveCommunityLimits(d *publiraplatformv1.CommunityLimitDefaults, v *publiraadminv1.TenantCommunityLimitOverrides) *publiraplatformv1.CommunityLimitDefaults {
	e := proto.Clone(d).(*publiraplatformv1.CommunityLimitDefaults)
	minute := func(dst, value *publiraplatformv1.MinuteDayLimit) {
		if value != nil {
			if value.PerMinute < dst.PerMinute {
				dst.PerMinute = value.PerMinute
			}
			if value.PerDay < dst.PerDay {
				dst.PerDay = value.PerDay
			}
		}
	}
	hour := func(dst, value *publiraplatformv1.HourDayLimit) {
		if value != nil {
			if value.PerHour < dst.PerHour {
				dst.PerHour = value.PerHour
			}
			if value.PerDay < dst.PerDay {
				dst.PerDay = value.PerDay
			}
		}
	}
	minute(e.CommentPost, v.CommentPost)
	minute(e.CommentReport, v.CommentReport)
	minute(e.EpisodeRating, v.EpisodeRating)
	minute(e.ViewerPreferences, v.ViewerPreferences)
	hour(e.ContactMessagePerAccount, v.ContactMessagePerAccount)
	hour(e.ContactMessagePerClient, v.ContactMessagePerClient)
	if v.DuplicateCommentWindowMinutes != nil && *v.DuplicateCommentWindowMinutes > e.DuplicateCommentWindowMinutes {
		e.DuplicateCommentWindowMinutes = *v.DuplicateCommentWindowMinutes
	}
	return e
}
func (s *adminServer) GetTenantCommunityLimitSettings(ctx context.Context, req *connect.Request[publiraadminv1.GetTenantCommunityLimitSettingsRequest]) (*connect.Response[publiraadminv1.GetTenantCommunityLimitSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	policy, _, err := platformpolicy.Read(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read platform policy", err)
	}
	row, err := s.queriesFor(ctx).GetTenantCommunityLimitOverrides(ctx, tenant.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return connect.NewResponse(&publiraadminv1.GetTenantCommunityLimitSettingsResponse{Overrides: &publiraadminv1.TenantCommunityLimitOverrides{}, PlatformDefaults: communityDefaults(policy.Community), Effective: communityDefaults(policy.Community)}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read tenant community limits", err)
	}
	overrides := communityOverridesFromRow(row)
	defaults := communityDefaults(policy.Community)
	return connect.NewResponse(&publiraadminv1.GetTenantCommunityLimitSettingsResponse{Overrides: overrides, PlatformDefaults: defaults, Effective: effectiveCommunityLimits(defaults, overrides), Revision: row.Revision}), nil
}
func (s *adminServer) UpdateTenantCommunityLimitSettings(ctx context.Context, req *connect.Request[publiraadminv1.UpdateTenantCommunityLimitSettingsRequest]) (*connect.Response[publiraadminv1.UpdateTenantCommunityLimitSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if req.Msg.Overrides == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("overrides is required"))
	}
	if req.Msg.ExpectedRevision < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("expected_revision must not be negative"))
	}
	policy, _, err := platformpolicy.Read(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read platform policy", err)
	}
	if err := validateCommunityOverrides(req.Msg.Overrides, communityDefaults(policy.Community)); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin community limits transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)
	current, err := txq.LockTenantCommunityLimitOverrides(ctx, tenant.ID)
	var updated dbmodels.TenantCommunityLimitOverride
	p := communityOverridesParams(tenant.ID, req.Msg.Overrides)
	if errors.Is(err, sql.ErrNoRows) {
		if req.Msg.ExpectedRevision != 0 {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errTenantCommunityLimitConflict)
		}
		updated, err = txq.InsertTenantCommunityLimitOverrides(ctx, communityOverridesInsertParams(p))
	} else if err == nil {
		if current.Revision != req.Msg.ExpectedRevision {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errTenantCommunityLimitConflict)
		}
		updated, err = txq.UpdateTenantCommunityLimitOverrides(ctx, p)
	}
	if dberr.IsUniqueViolation(err) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errTenantCommunityLimitConflict)
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to save tenant community limits", err)
	}
	if err = auditlog.WriteTenant(ctx, txq, s.logger, auditlog.TenantEntry{TenantID: tenant.ID, ActorUserID: session.User.ID, ActorRole: session.Role, Action: "tenant_community_limits_updated", TargetType: "tenant_community_limits", TargetID: tenant.PublicID, Outcome: auditlog.OutcomeSuccess, ClientIP: auditlog.ClientIPFromHeader(req.Header())}); err != nil {
		return nil, s.internalDBError(ctx, "failed to audit tenant community limits", err)
	}
	if err = tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant community limits", err)
	}
	policy, _, err = platformpolicy.Read(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read platform policy", err)
	}
	defaults := communityDefaults(policy.Community)
	overrides := communityOverridesFromRow(updated)
	return connect.NewResponse(&publiraadminv1.UpdateTenantCommunityLimitSettingsResponse{Overrides: overrides, PlatformDefaults: defaults, Effective: effectiveCommunityLimits(defaults, overrides), Revision: updated.Revision}), nil
}
