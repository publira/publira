package publicapi

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// The reader-writable RPCs share one flood control.
//
// Comments are the first thing a signed-in stranger can put in front of every
// other reader of a tenant, and every reader-writable RPC added after them is
// the same kind of surface. So the guard belongs to the surface rather than to
// the comment handler: a new RPC names an action here, gives it rules, and
// charges it, and the mechanism underneath is the one in internal/ratelimit.

// readerAction names one reader-writable RPC. It is part of the key the
// counters are kept under, so renaming one resets its budgets.
type readerAction string

const (
	actionPostComment   readerAction = "comment.post"
	actionReportComment readerAction = "comment.report"
	// Every press of the rating control charges, because every press that adds
	// a point files an event of its own.
	actionRateEpisode readerAction = "episode.rate"
	// The step-up password check ChangePassword, DeleteMe and RequestEmailChange
	// make on top of the session. One action for all three: an allowance held
	// per RPC would hand a guesser three budgets to rotate between.
	//
	// This one is charged before the password is verified rather than before the
	// first write, so an attempt past the limit costs no bcrypt and reaches no
	// row, and it is cleared once a password verifies — the count is there to
	// bound guessing, and the caller who knows the password is not guessing.
	// resource_exhausted is what distinguishes the refusal from the
	// invalid_argument a wrong password gets, so a client can tell the reader to
	// come back later instead of repeating "your password is wrong" at someone
	// who typed it correctly.
	actionVerifyPassword readerAction = "password.verify"
	// How the reader wants the viewer laid out. The control that writes it sits
	// in the viewer rather than on a settings screen, so a press is as cheap as
	// a rating's and the budget is the same size.
	actionUpdateViewerPreferences readerAction = "viewer.preferences.update"
	// The reader's notification settings. Each request upserts the reader's
	// settings row however much of it the request names, so the budget counts
	// requests rather than the settings they carry.
	actionUpdateNotificationSettings readerAction = "notification.settings.update"
	// A message written to the tenant's staff through the contact form. It is
	// the one reader-writable RPC a guest may reach, so it is charged twice: the
	// account holds one allowance when there is an account, and the client holds
	// another whether or not anyone is signed in. Without the second, a sender
	// who never signs in would have no allowance at all.
	actionSubmitContactMessage           readerAction = "contact.submit"
	actionSubmitContactMessageFromClient readerAction = "contact.submit.client"
	// A store transaction handed to ConfirmStorePurchase. Charged before the
	// transaction is verified, because a transaction the server has not seen is
	// verified with the store on the tenant's credentials and API quota.
	actionConfirmStorePurchase readerAction = "store_purchase.confirm"
	// A request to spend a wait-for-free ticket. One that succeeds is bounded
	// by the series' recharge interval; the budget is for the ones refused,
	// each of which reads the episode, the rule, and the reader's grants.
	actionUseWaitFreeTicket readerAction = "wait_free.use"
	// An agreement to the tenant's terms of service or privacy policy. One sent
	// twice writes nothing, but each request reads the tenant's legal pages and
	// the versions it names, and a reader can name every version the pages
	// have ever published.
	actionAgreeToLegalPages readerAction = "legal_pages.agree"
	// A provider account linked to the reader's account. A reader keeps one per
	// provider, but a refused link spends no nonce, so the same sign-in can be
	// sent again, and each one verifies the token and reads the reader's links.
	actionLinkIdentity readerAction = "identity.link"
	// An upload or a removal of the reader's icon. An upload is decoded,
	// scaled, and stored as an object that stays in the bucket until the
	// orphan sweep reclaims it, so the budget bounds what one account can leave
	// there; a removal shares it, so alternating the two is no way around it.
	actionChangeIcon readerAction = "icon.change"
	// A passkey registration or confirmation begun, or a passkey renamed or
	// removed. A begin stores a ceremony until it expires, and the account's
	// cap on open ceremonies drops the oldest rather than refusing, so without
	// this an account could make the storefront write one as fast as it asks.
	// A registration is charged as it begins and not again as it finishes,
	// since its finish needs a ceremony that a begin stored.
	actionPasskey readerAction = "passkey"
	// A checkout of the rest of a series started. Each start may write a
	// series bundle and asks the payment provider for a checkout, which a
	// reader could otherwise make the storefront repeat as fast as they ask.
	actionStartSeriesRemainderCheckout readerAction = "series_remainder_checkout.start"
	// A subscription checkout started. Each start writes the reader's latest
	// checkout, may expire the one before it, and asks the payment provider
	// for a checkout.
	actionStartSubscriptionCheckout readerAction = "subscription_checkout.start"
	// An episode paid for with coins. Each payment writes a purchase and the
	// coins it spent.
	actionPayWithCoins readerAction = "coin_payment.pay"
	// A purchase of an episode, a volume, or a coin pack started. A checkout
	// writes nothing, so no row bounds it, but each one asks the payment
	// provider for a checkout on the tenant's credentials. A store purchase
	// writes its intent again on every start, even when it is already open.
	// They all share the allowance, so moving from one to another, or from the
	// web to the app, buys a reader no more requests.
	actionStartPurchaseCheckout readerAction = "purchase_checkout.start"
)

// readerGuards is the flood control the reader-writable RPCs charge against.
type readerGuards struct {
	limiter *ratelimit.Limiter
	// policy answers the limits in force. An action readerRules names no rules
	// for is not rate limited at all, so adding an RPC to the flood control is
	// an entry there and a charge in the handler.
	policy platformpolicy.Source
}

// newReaderGuards charges the counters the deployment shares against the
// platform policy.
func newReaderGuards(policy platformpolicy.Source, logger *slog.Logger) readerGuards {
	return readerGuards{limiter: ratelimit.NewFromEnv(logger), policy: policy}
}

// readerRules pairs a burst window with a daily budget for each action. The
// minute keeps a script from emptying the day's budget in one breath, and the
// day is what a script pacing itself under the minute still runs into. The
// contact form counts in hours, because a minute is shorter than it takes to
// write one.
func readerRules(policy platformpolicy.Policy) map[readerAction][]ratelimit.Rule {
	community := policy.Community
	return map[readerAction][]ratelimit.Rule{
		actionPostComment:                    minuteDayRules(community.CommentPost),
		actionReportComment:                  minuteDayRules(community.CommentReport),
		actionRateEpisode:                    minuteDayRules(community.EpisodeRating),
		actionVerifyPassword:                 minuteDayRules(policy.PasswordVerification),
		actionUpdateViewerPreferences:        minuteDayRules(community.ViewerPreferencesUpdate),
		actionUpdateNotificationSettings:     minuteDayRules(community.NotificationSettingsUpdate),
		actionSubmitContactMessage:           hourDayRules(community.ContactMessagePerAccount),
		actionSubmitContactMessageFromClient: hourDayRules(community.ContactMessagePerClient),
		actionConfirmStorePurchase:           minuteDayRules(policy.StorePurchaseConfirmation),
		actionUseWaitFreeTicket:              minuteDayRules(policy.WaitFreeTicketUse),
		actionAgreeToLegalPages:              minuteDayRules(policy.LegalPageAgreement),
		actionLinkIdentity:                   minuteDayRules(policy.IdentityLink),
		actionChangeIcon:                     minuteDayRules(policy.IconChange),
		actionPasskey:                        minuteDayRules(policy.Passkey),
		actionStartSeriesRemainderCheckout:   minuteDayRules(policy.SeriesRemainderCheckout),
		actionStartSubscriptionCheckout:      minuteDayRules(policy.SubscriptionCheckout),
		actionPayWithCoins:                   minuteDayRules(policy.CoinPayment),
		actionStartPurchaseCheckout:          minuteDayRules(policy.PurchaseCheckout),
	}
}

func minuteDayRules(limit platformpolicy.MinuteDay) []ratelimit.Rule {
	return []ratelimit.Rule{
		{Limit: limit.PerMinute, Window: time.Minute},
		{Limit: limit.PerDay, Window: 24 * time.Hour},
	}
}

func hourDayRules(limit platformpolicy.HourDay) []ratelimit.Rule {
	return []ratelimit.Rule{
		{Limit: limit.PerHour, Window: time.Hour},
		{Limit: limit.PerDay, Window: 24 * time.Hour},
	}
}

// withDefaults fills in what a caller left unset. Handing the reader-writable
// RPCs a limiter that is not there would take the guard off them silently, so
// the zero value is the built-in policy over in-process counters rather than no
// policy at all.
func (g readerGuards) withDefaults() readerGuards {
	if g.limiter == nil {
		g.limiter = ratelimit.New(ratelimit.NewMemoryStore())
	}
	if g.policy == nil {
		g.policy = platformpolicy.Fixed(platformpolicy.Defaults())
	}
	return g
}

// readerPolicy resolves the policy in force for this request.
func (s *apiServer) readerPolicy(ctx context.Context) (platformpolicy.Policy, error) {
	policy, err := s.guards.policy.Policy(ctx)
	if err != nil {
		return platformpolicy.Policy{}, s.internalError(ctx, "failed to resolve the platform policy", err)
	}
	return policy, nil
}

// readerPolicyForTenant resolves the community half against the tenant's
// stored override. The platform value is still the ceiling: an older override
// can never become looser when an operator lowers that ceiling later.
func (s *apiServer) readerPolicyForTenant(ctx context.Context, tenantID uuid.UUID) (platformpolicy.Policy, error) {
	policy, err := s.readerPolicy(ctx)
	if err != nil {
		return platformpolicy.Policy{}, err
	}
	override, err := s.queriesFor(ctx).GetTenantCommunityLimitOverrides(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return policy, nil
	}
	if err != nil {
		return platformpolicy.Policy{}, s.internalDBError(ctx, "failed to read tenant community limits", err, "tenant_id", tenantID.String())
	}
	min := func(a, b int) int {
		if b < a {
			return b
		}
		return a
	}
	if override.CommentPostLimitPerMinute.Valid {
		policy.Community.CommentPost.PerMinute = min(policy.Community.CommentPost.PerMinute, int(override.CommentPostLimitPerMinute.Int32))
		policy.Community.CommentPost.PerDay = min(policy.Community.CommentPost.PerDay, int(override.CommentPostLimitPerDay.Int32))
	}
	if override.CommentReportLimitPerMinute.Valid {
		policy.Community.CommentReport.PerMinute = min(policy.Community.CommentReport.PerMinute, int(override.CommentReportLimitPerMinute.Int32))
		policy.Community.CommentReport.PerDay = min(policy.Community.CommentReport.PerDay, int(override.CommentReportLimitPerDay.Int32))
	}
	if override.CommentDuplicateWindowMinutes.Valid {
		d := time.Duration(override.CommentDuplicateWindowMinutes.Int32) * time.Minute
		if d > policy.Community.DuplicateCommentWindow {
			policy.Community.DuplicateCommentWindow = d
		}
	}
	if override.EpisodeRatingLimitPerMinute.Valid {
		policy.Community.EpisodeRating.PerMinute = min(policy.Community.EpisodeRating.PerMinute, int(override.EpisodeRatingLimitPerMinute.Int32))
		policy.Community.EpisodeRating.PerDay = min(policy.Community.EpisodeRating.PerDay, int(override.EpisodeRatingLimitPerDay.Int32))
	}
	if override.ContactMessageLimitPerAccountPerHour.Valid {
		policy.Community.ContactMessagePerAccount.PerHour = min(policy.Community.ContactMessagePerAccount.PerHour, int(override.ContactMessageLimitPerAccountPerHour.Int32))
		policy.Community.ContactMessagePerAccount.PerDay = min(policy.Community.ContactMessagePerAccount.PerDay, int(override.ContactMessageLimitPerAccountPerDay.Int32))
	}
	if override.ContactMessageLimitPerClientPerHour.Valid {
		policy.Community.ContactMessagePerClient.PerHour = min(policy.Community.ContactMessagePerClient.PerHour, int(override.ContactMessageLimitPerClientPerHour.Int32))
		policy.Community.ContactMessagePerClient.PerDay = min(policy.Community.ContactMessagePerClient.PerDay, int(override.ContactMessageLimitPerClientPerDay.Int32))
	}
	if override.ViewerPreferencesLimitPerMinute.Valid {
		policy.Community.ViewerPreferencesUpdate.PerMinute = min(policy.Community.ViewerPreferencesUpdate.PerMinute, int(override.ViewerPreferencesLimitPerMinute.Int32))
		policy.Community.ViewerPreferencesUpdate.PerDay = min(policy.Community.ViewerPreferencesUpdate.PerDay, int(override.ViewerPreferencesLimitPerDay.Int32))
	}
	if override.NotificationSettingsLimitPerMinute.Valid {
		policy.Community.NotificationSettingsUpdate.PerMinute = min(policy.Community.NotificationSettingsUpdate.PerMinute, int(override.NotificationSettingsLimitPerMinute.Int32))
		policy.Community.NotificationSettingsUpdate.PerDay = min(policy.Community.NotificationSettingsUpdate.PerDay, int(override.NotificationSettingsLimitPerDay.Int32))
	}
	return policy, nil
}

// readerActionSubject names whose budget is being spent. The tenant is part of
// it as well as the reader: a user row belongs to one tenant, but a limit that
// left the tenant out would be one storefront's flood spending another's
// budget the day user identity is ever shared between them.
func readerActionSubject(action readerAction, tenantID, userID uuid.UUID) string {
	return string(action) + ":" + tenantID.String() + ":" + userID.String()
}

// clientActionSubject names the allowance one caller holds, whoever they are
// signed in as. It is what stands in front of an RPC a guest may reach, where
// there is no account to hold a budget.
//
// The tenant is deliberately absent. What this bounds is one client spreading
// the same traffic over every storefront on the platform, which a key per
// tenant would let them do once per tenant.
func clientActionSubject(action readerAction, client string) string {
	return string(action) + ":client:" + client
}

// chargeReaderAction spends one of the reader's allowances for action, and
// answers resource_exhausted once they are out of them.
func (s *apiServer) chargeReaderAction(ctx context.Context, action readerAction, tenantID, userID uuid.UUID) error {
	return s.chargeTenantAction(ctx, action, tenantID, readerActionSubject(action, tenantID, userID), "tenant_id", tenantID.String())
}

// chargeClientAction spends one of the calling client's allowances for action.
//
// It is charged alongside the reader's rather than instead of it: a sender who
// is signed in spends both, so neither a borrowed account nor a fresh one taken
// out for the purpose widens what one client can send.
func (s *apiServer) chargeClientAction(ctx context.Context, action readerAction, tenantID uuid.UUID) error {
	client := clientip.FromContext(ctx)
	return s.chargeTenantAction(ctx, action, tenantID, clientActionSubject(action, client))
}

func (s *apiServer) chargeTenantAction(ctx context.Context, action readerAction, tenantID uuid.UUID, subject string, logAttrs ...any) error {
	policy, err := s.readerPolicyForTenant(ctx, tenantID)
	if err != nil {
		return err
	}
	rules := readerRules(policy)[action]
	if len(rules) == 0 {
		return nil
	}
	decision, err := s.guards.limiter.Allow(ctx, subject, rules...)
	if err != nil {
		return s.internalError(ctx, "failed to apply the reader rate limit", err, append(logAttrs, "action", string(action))...)
	}
	if decision.Allowed {
		return nil
	}
	return rpcerrors.NewRateLimitedError(ctx, decision.RetryAfter)
}

// clearReaderAction gives the reader back everything action has cost them.
//
// It is the counterpart the step-up password check needs and no other action
// uses: a budget that bounds guessing has to be cleared by the attempt that was
// not a guess. Holding the count past a password that verified would lock an
// account out of its own settings over typos, and it would bound nothing —
// what the limit is there for is the caller who does not know the password, and
// that caller never gets this far.
func (s *apiServer) clearReaderAction(ctx context.Context, action readerAction, tenantID, userID uuid.UUID) {
	policy, err := s.guards.policy.Policy(ctx)
	if err != nil {
		s.logger.WarnContext(ctx, "failed to resolve the platform policy to clear a reader allowance", "action", string(action), "error", err)
		return
	}
	rules := readerRules(policy)[action]
	if len(rules) == 0 {
		return
	}
	s.guards.limiter.Reset(ctx, readerActionSubject(action, tenantID, userID), rules...)
}

// duplicateCommentKey names one reader repeating themselves on one episode.
//
// The body reaches the key as a digest: the limiter holds nothing a reader
// wrote, and the key stays the same size whether the comment is a word or a
// thousand of them.
func duplicateCommentKey(tenantID, userID, episodeID uuid.UUID, body string) string {
	digest := sha256.Sum256([]byte(body))
	return "comment.duplicate:" + tenantID.String() + ":" + userID.String() + ":" + episodeID.String() + ":" + hex.EncodeToString(digest[:])
}

// claimCommentBody takes the reader's place for one body on one episode, and
// refuses a body they have already posted there inside the window.
//
// A refusal is already_exists rather than the rate limit's resource_exhausted:
// the reader has not run out of anything, and what they meant to say is on the
// page already.
func (s *apiServer) claimCommentBody(ctx context.Context, tenantID uuid.UUID, key string) error {
	policy, err := s.readerPolicyForTenant(ctx, tenantID)
	if err != nil {
		return err
	}
	fresh, err := s.guards.limiter.Claim(ctx, key, policy.Community.DuplicateCommentWindow)
	if err != nil {
		return s.internalError(ctx, "failed to claim the comment body", err)
	}
	if !fresh {
		return connect.NewError(connect.CodeAlreadyExists, "the same comment was posted a moment ago")
	}
	return nil
}
