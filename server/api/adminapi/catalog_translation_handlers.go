package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// catalogLocale is the locale a write of a series or episode title names: the
// tenant's default for an empty value, and otherwise a locale the tenant
// offers. A title in a language the site does not serve could be stored but
// never shown, so it is refused rather than kept out of sight.
func catalogLocale(raw string, tenant dbmodels.Tenant) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return tenant.DefaultLocale, nil
	}
	code, err := locale.Normalize(raw)
	if err != nil || !slices.Contains(tenant.SupportedLocales, code) {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("locale must be a locale the tenant offers"), "locale")
	}
	return code, nil
}

// upsertSeriesTranslation writes one locale's title, and its synopsis where
// synopsis is not nil, on the querier txCtx carries.
func (s *adminServer) upsertSeriesTranslation(txCtx context.Context, tenantID, seriesID uuid.UUID, code, title string, synopsis *string) error {
	id, err := uuid.NewV7()
	if err != nil {
		return connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	params := dbmodels.UpsertSeriesTranslationParams{
		ID:       id,
		SeriesID: seriesID,
		TenantID: tenantID,
		Locale:   code,
		Title:    title,
	}
	if synopsis != nil {
		params.Synopsis = *synopsis
		params.WriteSynopsis = true
	}
	if _, err := s.queriesFor(txCtx).UpsertSeriesTranslation(txCtx, params); err != nil {
		return s.internalDBError(txCtx, "failed to write series translation", err, "tenant_id", tenantID.String(), "series_id", seriesID.String(), "locale", code)
	}
	return nil
}

// upsertEpisodeTranslation writes one locale's title on the querier txCtx
// carries.
func (s *adminServer) upsertEpisodeTranslation(txCtx context.Context, tenantID, episodeID uuid.UUID, code, title string) error {
	id, err := uuid.NewV7()
	if err != nil {
		return connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	if _, err := s.queriesFor(txCtx).UpsertEpisodeTranslation(txCtx, dbmodels.UpsertEpisodeTranslationParams{
		ID:        id,
		EpisodeID: episodeID,
		TenantID:  tenantID,
		Locale:    code,
		Title:     title,
	}); err != nil {
		return s.internalDBError(txCtx, "failed to write episode translation", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String(), "locale", code)
	}
	return nil
}

func (s *adminServer) seriesTranslations(ctx context.Context, tenantID, seriesID uuid.UUID) ([]*publiraadminv1.SeriesTranslation, error) {
	rows, err := s.queriesFor(ctx).ListSeriesTranslationsForTenant(ctx, dbmodels.ListSeriesTranslationsForTenantParams{
		TenantID: tenantID,
		SeriesID: seriesID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list series translations", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
	translations := make([]*publiraadminv1.SeriesTranslation, 0, len(rows))
	for _, row := range rows {
		translations = append(translations, &publiraadminv1.SeriesTranslation{
			Locale:    row.Locale,
			Title:     row.Title,
			Synopsis:  row.Synopsis,
			CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
			UpdatedAt: row.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	return translations, nil
}

func (s *adminServer) episodeTranslations(ctx context.Context, tenantID, episodeID uuid.UUID) ([]*publiraadminv1.EpisodeTranslation, error) {
	rows, err := s.queriesFor(ctx).ListEpisodeTranslationsForTenant(ctx, dbmodels.ListEpisodeTranslationsForTenantParams{
		TenantID:  tenantID,
		EpisodeID: episodeID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode translations", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	translations := make([]*publiraadminv1.EpisodeTranslation, 0, len(rows))
	for _, row := range rows {
		translations = append(translations, &publiraadminv1.EpisodeTranslation{
			Locale:    row.Locale,
			Title:     row.Title,
			CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
			UpdatedAt: row.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	return translations, nil
}

// parseTranslationLocale reads the locale a deletion names. It is not held to
// the tenant's offered locales: a translation left behind in a language the
// tenant has since switched off is one an editor must still be able to delete.
func parseTranslationLocale(raw string) (string, error) {
	code, err := locale.Normalize(raw)
	if err != nil {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("locale must be a supported locale"), "locale")
	}
	return code, nil
}

func (s *adminServer) DeleteSeriesTranslation(
	ctx context.Context,
	req *publiraadminv1.DeleteSeriesTranslationRequest,
) (*publiraadminv1.DeleteSeriesTranslationResponse, error) {
	sessionCtx, err := s.requireTenantEditor(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	seriesID, err := parseRecordID(req.SeriesId, "series_id")
	if err != nil {
		return nil, err
	}
	code, err := parseTranslationLocale(req.Locale)
	if err != nil {
		return nil, err
	}

	var publicID string
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		// The lock keeps two deletions from each seeing the other's translation
		// still there and together leaving the series with none.
		locked, err := queries.LockSeriesByIDForTenant(txCtx, dbmodels.LockSeriesByIDForTenantParams{TenantID: tenant.ID, ID: seriesID})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, "series not found")
			}
			return nil, s.internalDBError(ctx, "failed to lock series for translation deletion", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
		}
		publicID = locked.PublicID
		count, err := queries.CountSeriesTranslations(txCtx, dbmodels.CountSeriesTranslationsParams{TenantID: tenant.ID, SeriesID: seriesID})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to count series translations", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
		}
		deleted, err := queries.DeleteSeriesTranslation(txCtx, dbmodels.DeleteSeriesTranslationParams{TenantID: tenant.ID, SeriesID: seriesID, Locale: code})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to delete series translation", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String(), "locale", code)
		}
		if deleted == 0 {
			return nil, connect.NewError(connect.CodeNotFound, "series translation not found")
		}
		if count <= 1 {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "a series must keep at least one translation")
		}
		if err := queries.TouchSeriesUpdatedAt(txCtx, dbmodels.TouchSeriesUpdatedAtParams{TenantID: tenant.ID, ID: seriesID}); err != nil {
			return nil, s.internalDBError(ctx, "failed to touch series after translation deletion", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
		}
		// The translation may have been the one a locale was served, or the one
		// the search document carries.
		if err := catalogindex.Queue(txCtx, queries, tenant.ID, catalogindex.SeriesRef(seriesID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to queue the search index sync for the series translation deletion", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
		}
		return seriesRevalidateTags(tenant.ID.String(), locked.PublicID), nil
	}); err != nil {
		return nil, err
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "series_translation_deleted",
		TargetType:  "series",
		TargetID:    publicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientip.FromContext(ctx),
	})
	translations, err := s.seriesTranslations(ctx, tenant.ID, seriesID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.DeleteSeriesTranslationResponse{Translations: translations}, nil
}

func (s *adminServer) DeleteEpisodeTranslation(
	ctx context.Context,
	req *publiraadminv1.DeleteEpisodeTranslationRequest,
) (*publiraadminv1.DeleteEpisodeTranslationResponse, error) {
	sessionCtx, err := s.requireTenantEditor(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	code, err := parseTranslationLocale(req.Locale)
	if err != nil {
		return nil, err
	}

	var publicID string
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		// Locked for the reason DeleteSeriesTranslation locks the series.
		locked, err := queries.LockEpisodeByIDForTenant(txCtx, dbmodels.LockEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, "episode not found")
			}
			return nil, s.internalDBError(ctx, "failed to lock episode for translation deletion", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		publicID = locked.PublicID
		count, err := queries.CountEpisodeTranslations(txCtx, dbmodels.CountEpisodeTranslationsParams{TenantID: tenant.ID, EpisodeID: episodeID})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to count episode translations", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		deleted, err := queries.DeleteEpisodeTranslation(txCtx, dbmodels.DeleteEpisodeTranslationParams{TenantID: tenant.ID, EpisodeID: episodeID, Locale: code})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to delete episode translation", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String(), "locale", code)
		}
		if deleted == 0 {
			return nil, connect.NewError(connect.CodeNotFound, "episode translation not found")
		}
		if count <= 1 {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "an episode must keep at least one translation")
		}
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "episode_translation_deleted",
		TargetType:  "episode",
		TargetID:    publicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientip.FromContext(ctx),
	})
	translations, err := s.episodeTranslations(ctx, tenant.ID, episodeID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.DeleteEpisodeTranslationResponse{Translations: translations}, nil
}

// storedSynopsis is the synopsis a save writes: as it was sent, or empty for
// one of nothing but white space.
func storedSynopsis(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	return raw
}
