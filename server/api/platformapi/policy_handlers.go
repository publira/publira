package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
)

// errPlatformPolicyConflict is what a save based on a revision the stored row
// has moved past reports.
var errPlatformPolicyConflict = errors.New("platform policy has changed since it was read")

func minuteDayToProto(limit platformpolicy.MinuteDay) *publirasplatformv1.MinuteDayLimit {
	return &publirasplatformv1.MinuteDayLimit{PerMinute: int32(limit.PerMinute), PerDay: int32(limit.PerDay)}
}

func hourDayToProto(limit platformpolicy.HourDay) *publirasplatformv1.HourDayLimit {
	return &publirasplatformv1.HourDayLimit{PerHour: int32(limit.PerHour), PerDay: int32(limit.PerDay)}
}

func platformPolicyToProto(policy platformpolicy.Policy) *publirasplatformv1.PlatformPolicy {
	community := policy.Community
	return &publirasplatformv1.PlatformPolicy{
		MfaRequiredForTenantAdmin: policy.MFARequiredForTenantAdmin,
		PasswordVerification:      minuteDayToProto(policy.PasswordVerification),
		MailRequestsPerAddress:    hourDayToProto(policy.MailRequestsPerAddress),
		MailRequestsPerSource:     hourDayToProto(policy.MailRequestsPerSource),
		CommunityLimitDefaults: &publirasplatformv1.CommunityLimitDefaults{
			CommentPost:                   minuteDayToProto(community.CommentPost),
			CommentReport:                 minuteDayToProto(community.CommentReport),
			DuplicateCommentWindowMinutes: int32(community.DuplicateCommentWindow / time.Minute),
			EpisodeRating:                 minuteDayToProto(community.EpisodeRating),
			ContactMessagePerAccount:      hourDayToProto(community.ContactMessagePerAccount),
			ContactMessagePerClient:       hourDayToProto(community.ContactMessagePerClient),
			ViewerPreferences:             minuteDayToProto(community.ViewerPreferencesUpdate),
		},
	}
}

func minuteDayFromProto(limit *publirasplatformv1.MinuteDayLimit) platformpolicy.MinuteDay {
	return platformpolicy.MinuteDay{PerMinute: int(limit.GetPerMinute()), PerDay: int(limit.GetPerDay())}
}

func hourDayFromProto(limit *publirasplatformv1.HourDayLimit) platformpolicy.HourDay {
	return platformpolicy.HourDay{PerHour: int(limit.GetPerHour()), PerDay: int(limit.GetPerDay())}
}

// platformPolicyFromProto reads a request. A missing message reads as zeros,
// which Validate refuses, so an omitted value cannot be saved as a limit.
func platformPolicyFromProto(policy *publirasplatformv1.PlatformPolicy) platformpolicy.Policy {
	community := policy.GetCommunityLimitDefaults()
	return platformpolicy.Policy{
		MFARequiredForTenantAdmin: policy.GetMfaRequiredForTenantAdmin(),
		PasswordVerification:      minuteDayFromProto(policy.GetPasswordVerification()),
		MailRequestsPerAddress:    hourDayFromProto(policy.GetMailRequestsPerAddress()),
		MailRequestsPerSource:     hourDayFromProto(policy.GetMailRequestsPerSource()),
		Community: platformpolicy.CommunityLimits{
			CommentPost:              minuteDayFromProto(community.GetCommentPost()),
			CommentReport:            minuteDayFromProto(community.GetCommentReport()),
			DuplicateCommentWindow:   time.Duration(community.GetDuplicateCommentWindowMinutes()) * time.Minute,
			EpisodeRating:            minuteDayFromProto(community.GetEpisodeRating()),
			ContactMessagePerAccount: hourDayFromProto(community.GetContactMessagePerAccount()),
			ContactMessagePerClient:  hourDayFromProto(community.GetContactMessagePerClient()),
			ViewerPreferencesUpdate:  minuteDayFromProto(community.GetViewerPreferences()),
		},
	}
}

func (s *platformServer) GetPlatformPolicy(
	ctx context.Context,
	_ *connect.Request[publirasplatformv1.GetPlatformPolicyRequest],
) (*connect.Response[publirasplatformv1.GetPlatformPolicyResponse], error) {
	policy, revision, err := platformpolicy.Read(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read platform policy", err)
	}
	return connect.NewResponse(&publirasplatformv1.GetPlatformPolicyResponse{
		Policy:   platformPolicyToProto(policy),
		Revision: revision,
	}), nil
}

// writePlatformPolicy locks the row, compares its revision with the one the
// request states, and writes only when they match.
func (s *platformServer) writePlatformPolicy(
	ctx context.Context,
	policy platformpolicy.Policy,
	expectedRevision int64,
) (dbmodels.PlatformPolicyConfig, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformPolicyConfig{}, s.internalDBError(ctx, "failed to begin update platform policy transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)
	params := policy.ConfigParams()

	var updated dbmodels.PlatformPolicyConfig
	current, err := txq.LockPlatformPolicyConfig(ctx)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if expectedRevision != 0 {
			return dbmodels.PlatformPolicyConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformPolicyConflict)
		}
		updated, err = txq.InsertPlatformPolicyConfig(ctx, dbmodels.InsertPlatformPolicyConfigParams(params))
		if err != nil {
			// Two first saves both find nothing to lock; the primary key
			// settles which one wins.
			if dberr.IsUniqueViolation(err) {
				return dbmodels.PlatformPolicyConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformPolicyConflict)
			}
			return dbmodels.PlatformPolicyConfig{}, s.internalDBError(ctx, "failed to create platform policy", err)
		}
	case err != nil:
		return dbmodels.PlatformPolicyConfig{}, s.internalDBError(ctx, "failed to lock platform policy", err)
	default:
		if expectedRevision != current.Revision {
			return dbmodels.PlatformPolicyConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformPolicyConflict)
		}
		updated, err = txq.UpdatePlatformPolicyConfig(ctx, params)
		if err != nil {
			return dbmodels.PlatformPolicyConfig{}, s.internalDBError(ctx, "failed to update platform policy", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformPolicyConfig{}, s.internalDBError(ctx, "failed to commit platform policy", err)
	}
	return updated, nil
}

func (s *platformServer) UpdatePlatformPolicy(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformPolicyRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformPolicyResponse], error) {
	if req.Msg.GetPolicy() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("policy is required"))
	}
	policy := platformPolicyFromProto(req.Msg.GetPolicy())
	if err := policy.Validate(); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if req.Msg.ExpectedRevision < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("expected_revision must not be negative"))
	}

	updated, err := s.writePlatformPolicy(ctx, policy, req.Msg.ExpectedRevision)
	if err != nil {
		return nil, err
	}

	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "platform_policy_updated",
			TargetType:          "platform_policy",
			TargetID:            "platform",
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.UpdatePlatformPolicyResponse{
		Policy:   platformPolicyToProto(platformpolicy.FromConfig(updated)),
		Revision: updated.Revision,
	}), nil
}
