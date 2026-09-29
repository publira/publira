package platformapi

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

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
		StorePurchaseConfirmation: minuteDayToProto(policy.StorePurchaseConfirmation),
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
		StorePurchaseConfirmation: minuteDayFromProto(policy.GetStorePurchaseConfirmation()),
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

// platformPolicyError maps what platformpolicy refuses to this API's codes,
// naming the request field when the refusal has one.
func (s *platformServer) platformPolicyError(ctx context.Context, err error) error {
	if connectErr := rpcerrors.FromFieldError(err); connectErr != nil {
		return connectErr
	}
	if errors.Is(err, platformpolicy.ErrConflict) {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	return s.internalDBError(ctx, "failed to save platform policy", err)
}

func (s *platformServer) UpdatePlatformPolicy(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformPolicyRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformPolicyResponse], error) {
	if req.Msg.GetPolicy() == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("policy is required"), platformpolicy.FieldPolicy)
	}
	expectedRevision := req.Msg.GetExpectedRevision()
	params := platformpolicy.SaveParams{
		Policy:           platformPolicyFromProto(req.Msg.GetPolicy()),
		ExpectedRevision: &expectedRevision,
	}
	if err := params.Validate(); err != nil {
		return nil, s.platformPolicyError(ctx, err)
	}
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}

	updated, err := platformpolicy.Save(ctx, s.db, s.logger, actor, params)
	if err != nil {
		return nil, s.platformPolicyError(ctx, err)
	}
	return connect.NewResponse(&publirasplatformv1.UpdatePlatformPolicyResponse{
		Policy:   platformPolicyToProto(platformpolicy.FromConfig(updated)),
		Revision: updated.Revision,
	}), nil
}
