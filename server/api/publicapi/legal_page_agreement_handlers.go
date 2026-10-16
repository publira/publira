package publicapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// errLegalPageAgreementRequired is the cause of every refusal a reader who
// owes an agreement gets.
var errLegalPageAgreementRequired = errors.New("agree to the tenant's revised terms of service or privacy policy first")

// proceduresWithoutLegalPageAgreement are the RPCs requiring a session that a
// reader who owes an agreement may still call: what reads their account and
// what they own, the writes that only record their reading of it, finishing a
// store purchase the store has already charged for, signing out, deleting the
// account and beginning the passkey assertion that confirms it, and agreeing. Everything else that requires a session is refused,
// so an RPC added later is refused until it is listed here, rather than open to
// a reader the tenant is waiting on.
//
// The check is made where a session is required (currentUserFromSession) and
// not where it is optional: those RPCs answer a guest too, and the catalog, an
// announcement, and an episode the reader owns read the same either way.
var proceduresWithoutLegalPageAgreement = map[string]bool{
	publirav1connect.AuthServiceGetMyLegalPageAgreementsProcedure: true,
	publirav1connect.AuthServiceAgreeToLegalPagesProcedure:        true,
	publirav1connect.AuthServiceGetMeProcedure:                    true,
	publirav1connect.AuthServiceLogoutProcedure:                   true,
	publirav1connect.AuthServiceDeleteMeProcedure:                 true,
	publirav1connect.AuthServiceListMyIdentitiesProcedure:         true,
	publirav1connect.AuthServiceListMyPasskeysProcedure:           true,
	// An account with neither a password nor a linked provider confirms
	// DeleteMe with a passkey alone, so refusing this would leave it unable to
	// close itself until it agreed.
	publirav1connect.AuthServiceBeginPasskeyConfirmationProcedure:         true,
	publirav1connect.AuthServiceGetNotificationSettingsProcedure:          true,
	publirav1connect.AuthServiceGetViewerPreferencesProcedure:             true,
	publirav1connect.NotificationServiceListNotificationsProcedure:        true,
	publirav1connect.NotificationServiceCountUnreadNotificationsProcedure: true,
	// The app unregisters its device as it signs out.
	publirav1connect.NotificationServiceUnregisterPushDeviceProcedure: true,
	publirav1connect.CommentServiceListMyEpisodeCommentsProcedure:     true,
	publirav1connect.EpisodeReadServiceMarkEpisodeAsReadProcedure:     true,
	publirav1connect.EpisodeReadServiceSaveReadingPositionProcedure:   true,
	publirav1connect.EpisodeReadServiceGetMyReadingPositionProcedure:  true,
	publirav1connect.EpisodeReadServiceGetMySeriesProgressProcedure:   true,
	publirav1connect.EpisodeReadServiceListMyRecentSeriesProcedure:    true,
	publirav1connect.EpisodeReadServiceListMyEpisodeReadsProcedure:    true,
	publirav1connect.FollowServiceGetMyFollowStatusProcedure:          true,
	publirav1connect.FollowServiceListMyFollowsProcedure:              true,
	publirav1connect.FollowServiceListMyFollowUpdatesProcedure:        true,
	publirav1connect.RatingServiceGetMyEpisodeRatingProcedure:         true,
	publirav1connect.RatingServiceGetMySeriesRatingProcedure:          true,
	publirav1connect.PurchaseServiceListMyPurchasesProcedure:          true,
	// The store has already charged the reader by the time the app confirms,
	// so refusing it would leave a paid purchase unrecorded.
	publirav1connect.PurchaseServiceConfirmStorePurchaseProcedure:   true,
	publirav1connect.WaitFreeServiceGetMyTicketStateProcedure:       true,
	publirav1connect.CatalogServiceListMyRecommendedSeriesProcedure: true,
}

// requireLegalPageAgreement refuses a reader who owes an agreement an RPC
// proceduresWithoutLegalPageAgreement does not list. A handler called outside a
// Connect server names no procedure and is not checked, which is only ever a
// unit test calling it directly.
func (s *apiServer) requireLegalPageAgreement(ctx context.Context, tenant dbmodels.Tenant, user dbmodels.User) error {
	info, ok := connect.CallInfoForServerContext(ctx)
	if !ok || proceduresWithoutLegalPageAgreement[info.Spec.Procedure] {
		return nil
	}
	agreed, err := s.readerLegalPageAgreements(ctx, tenant.ID, user.ID)
	if err != nil {
		return err
	}
	if !agreed.TermsAgreed || !agreed.PrivacyAgreed {
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errLegalPageAgreementRequired, rpcerrors.ReasonLegalPageAgreementRequired)
	}
	return nil
}

// readerLegalPageAgreements answers a tenant with no config row as one that
// asks for no agreement, which is what the columns' NULL says too.
func (s *apiServer) readerLegalPageAgreements(ctx context.Context, tenantID, userID uuid.UUID) (dbmodels.GetReaderLegalPageAgreementsRow, error) {
	row, err := s.queriesFor(ctx).GetReaderLegalPageAgreements(ctx, dbmodels.GetReaderLegalPageAgreementsParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.GetReaderLegalPageAgreementsRow{TermsAgreed: true, PrivacyAgreed: true}, nil
	}
	if err != nil {
		return dbmodels.GetReaderLegalPageAgreementsRow{}, s.internalDBError(ctx, "failed to read the reader's legal page agreements", err, "tenant_id", tenantID.String(), "user_id", userID.String())
	}
	return row, nil
}

// owedLegalPages is each page the reader has still to agree to, in the version
// in force for the locale, and nil for each they owe nothing.
func (s *apiServer) owedLegalPages(ctx context.Context, tenant dbmodels.Tenant, userID uuid.UUID, readerLocale string) (terms, privacy *publirav1.TenantLegalPage, err error) {
	agreed, err := s.readerLegalPageAgreements(ctx, tenant.ID, userID)
	if err != nil {
		return nil, nil, err
	}
	if agreed.TermsAgreed && agreed.PrivacyAgreed {
		return nil, nil, nil
	}
	row, err := s.queriesFor(ctx).GetTenantLegalPages(ctx, dbmodels.GetTenantLegalPagesParams{
		TenantID: tenant.ID,
		Locale:   readerLocale,
	})
	if err != nil {
		return nil, nil, s.internalDBError(ctx, "failed to read the tenant legal pages", err, "tenant_id", tenant.ID.String())
	}
	terms, privacy = tenantLegalPagesFromRow(row)
	if agreed.TermsAgreed {
		terms = nil
	}
	if agreed.PrivacyAgreed {
		privacy = nil
	}
	return terms, privacy, nil
}

func (s *apiServer) GetMyLegalPageAgreements(
	ctx context.Context,
	req *publirav1.GetMyLegalPageAgreementsRequest,
) (*publirav1.GetMyLegalPageAgreementsResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}
	terms, privacy, err := s.owedLegalPages(ctx, tenant, user.ID, readerLocale)
	if err != nil {
		return nil, err
	}
	return noStorePrivateResponse(ctx, &publirav1.GetMyLegalPageAgreementsResponse{TermsPage: terms, PrivacyPage: privacy}), nil
}

// AgreeToLegalPages records an agreement to each version named.
func (s *apiServer) AgreeToLegalPages(
	ctx context.Context,
	req *publirav1.AgreeToLegalPagesRequest,
) (*publirav1.AgreeToLegalPagesResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}
	// Charged before the versions are read, which is the work an agreement
	// repeated past the limit would otherwise still cost.
	if err := s.chargeReaderAction(ctx, actionAgreeToLegalPages, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	versionIDs, err := s.legalPageAgreementVersions(ctx, tenant, req.AgreedPageVersionIds)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin legal page agreement transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)
	for _, versionID := range versionIDs {
		if err := txq.CreateUserPageConsent(ctx, dbmodels.CreateUserPageConsentParams{
			TenantID:      tenant.ID,
			UserID:        user.ID,
			PageVersionID: versionID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to record a legal page agreement", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String(), "page_version_id", versionID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit legal page agreements", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	terms, privacy, err := s.owedLegalPages(ctx, tenant, user.ID, readerLocale)
	if err != nil {
		return nil, err
	}
	return noStorePrivateResponse(ctx, &publirav1.AgreeToLegalPagesResponse{TermsPage: terms, PrivacyPage: privacy}), nil
}

// legalPageAgreementVersions parses the versions an agreement names and
// refuses any that is not a published version of the page the tenant names as
// its terms or its privacy policy, or that agrees to one page twice.
func (s *apiServer) legalPageAgreementVersions(ctx context.Context, tenant dbmodels.Tenant, rawIDs []string) ([]uuid.UUID, error) {
	invalid := func(message string) error {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New(message), "agreed_page_version_ids")
	}
	// Refused before any parsing or query, so a caller cannot make the server
	// read an unbounded list: there are two pages to agree to.
	if len(rawIDs) == 0 || len(rawIDs) > 2 {
		return nil, invalid("agree to one version of the terms, the privacy policy, or both")
	}
	versionIDs := make([]uuid.UUID, 0, len(rawIDs))
	for _, raw := range rawIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			return nil, invalid("agreed page version id is not a valid id")
		}
		versionIDs = append(versionIDs, id)
	}

	legal, err := s.queriesFor(ctx).GetTenantLegalPages(ctx, dbmodels.GetTenantLegalPagesParams{
		TenantID: tenant.ID,
		Locale:   tenant.DefaultLocale,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the tenant legal pages", err, "tenant_id", tenant.ID.String())
	}
	legalPages := map[uuid.UUID]bool{}
	if legal.TermsPageID.Valid {
		legalPages[legal.TermsPageID.UUID] = true
	}
	if legal.PrivacyPageID.Valid {
		legalPages[legal.PrivacyPageID.UUID] = true
	}

	versions, err := s.queriesFor(ctx).ListPublishedPageVersionsByIDsForTenant(ctx, dbmodels.ListPublishedPageVersionsByIDsForTenantParams{
		TenantID: tenant.ID,
		Ids:      versionIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read agreed page versions", err, "tenant_id", tenant.ID.String())
	}
	pageOf := make(map[uuid.UUID]uuid.UUID, len(versions))
	for _, version := range versions {
		pageOf[version.ID] = version.PageID
	}
	agreedPages := map[uuid.UUID]bool{}
	for _, id := range versionIDs {
		pageID, ok := pageOf[id]
		if !ok {
			return nil, invalid("agreed page version is not a published version of this tenant")
		}
		if !legalPages[pageID] {
			return nil, invalid("agreed page version is not of a page the tenant asks consent to")
		}
		if agreedPages[pageID] {
			return nil, invalid("more than one version agreed to for the same page")
		}
		agreedPages[pageID] = true
	}
	return versionIDs, nil
}
