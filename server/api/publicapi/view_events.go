package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	// anonymousIDCookieName carries the anonymous actor across requests so a
	// signed-out reader keeps aggregating into one actor_key. It holds a
	// server-minted UUIDv7 and nothing else: no IP, no user agent, no email.
	anonymousIDCookieName = "publira_aid"

	// anonymousIDCookieMaxAge outlives every window that reads the raw events
	// (content_events is purged at ~90 days), so a returning reader is
	// still recognised as the same actor, and then expires rather than leaving
	// an abandoned identifier alive indefinitely.
	anonymousIDCookieMaxAge = 180 * 24 * time.Hour

	// viewDebounceWindow spans a fixed epoch bucket, not a sliding window. The
	// bucket is floor(unix / 1800), so every request for the same episode in
	// the same half hour computes the same value and the partial unique index
	// collapses the repeats without the server reading the previous view.
	viewDebounceWindow = 30 * time.Minute
)

// softViewPayload marks what this file writes as soft PV: the event says the
// detail RPC succeeded, not that a reader was observed reading. Hard PV lands
// in the same table later and has to stay separable from this.
func softViewPayload() json.RawMessage {
	return json.RawMessage(`{"pv_kind":"soft"}`)
}

// viewActor identifies who a view belongs to. At most one field is set: a
// signed-in member is attributed to user_id and everyone else to the anonymous
// cookie, which is what content_events collapses into actor_key.
type viewActor struct {
	userID      uuid.NullUUID
	anonymousID uuid.NullUUID
}

func (a viewActor) resolved() bool {
	return a.userID.Valid || a.anonymousID.Valid
}

// resolveViewActor picks the actor for a view and, for a reader who has never
// been identified, mints one. The returned cookie is non-nil only when it was
// minted; the caller puts it on the response so the reader's next request
// resolves to the same anonymous_id.
//
// A caller whose bearer was rejected gets no minted identifier. userID is unset
// for it the same way it is for a signed-out reader, but the two are not the
// same case: a rejected bearer usually comes from a caller that cannot keep the
// cookie either — web-host sends one or the other and never relays the
// Set-Cookie — so minting would open a new actor on every request and put back
// exactly the unbounded actor growth this instrumentation was moved out of the
// detail reads to stop. Such a view is attributed to a cookie when one came
// with it, and otherwise not recorded at all.
func resolveViewActor(userID uuid.NullUUID, header http.Header) (viewActor, *http.Cookie) {
	if userID.Valid {
		return viewActor{userID: userID}, nil
	}
	if id, ok := anonymousIDFromCookie(header); ok {
		return viewActor{anonymousID: uuid.NullUUID{UUID: id, Valid: true}}, nil
	}
	if _, hasBearer := auth.BearerTokenFromHeader(header); hasBearer {
		return viewActor{}, nil
	}
	minted, err := uuid.NewV7()
	if err != nil {
		return viewActor{}, nil
	}
	return viewActor{anonymousID: uuid.NullUUID{UUID: minted, Valid: true}}, newAnonymousIDCookie(minted)
}

// anonymousIDFromCookie accepts the cookie only when it parses as a non-nil
// UUID. A client-supplied value reaches content_events.anonymous_id directly,
// so anything else is treated as absent and replaced by a minted identifier.
func anonymousIDFromCookie(header http.Header) (uuid.UUID, bool) {
	if header == nil {
		return uuid.Nil, false
	}
	cookie, err := (&http.Request{Header: header}).Cookie(anonymousIDCookieName)
	if err != nil {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(strings.TrimSpace(cookie.Value))
	if err != nil || id == uuid.Nil {
		return uuid.Nil, false
	}
	return id, true
}

// newAnonymousIDCookie keeps the attribute set minimal: the value is never read
// by client script (HttpOnly), never rides along on a cross-site request
// (SameSite=Lax), and never travels in clear text (Secure). Secure is
// unconditional — a client that drops the cookie is minted a fresh identifier
// on its next request, which is a better failure than putting an actor key on
// the wire in plain HTTP.
func newAnonymousIDCookie(id uuid.UUID) *http.Cookie {
	return &http.Cookie{
		Name:     anonymousIDCookieName,
		Value:    id.String(),
		Path:     "/",
		MaxAge:   int(anonymousIDCookieMaxAge / time.Second),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
}

// viewDebounceBucket is the fixed epoch bucket described on viewDebounceWindow.
func viewDebounceBucket(at time.Time) int64 {
	return at.UTC().Unix() / int64(viewDebounceWindow/time.Second)
}

// prefetchHeaderMarkers lists the request headers a prefetching client sets,
// each with the substring that marks the request as speculative.
var prefetchHeaderMarkers = map[string]string{
	"Sec-Purpose":          "prefetch",
	"Purpose":              "prefetch",
	"X-Purpose":            "preview",
	"X-Moz":                "prefetch",
	"Next-Router-Prefetch": "1",
}

// isPrefetchRequest reports whether the client announced the request as
// speculative. A prefetch is a guess about what may be read next, so counting
// it would credit every popular listing page's neighbours with views nobody
// looked at. Only the client can tell us this, so the filter is best effort.
func isPrefetchRequest(header http.Header) bool {
	if header == nil {
		return false
	}
	for name, marker := range prefetchHeaderMarkers {
		if strings.Contains(strings.ToLower(header.Get(name)), marker) {
			return true
		}
	}
	return false
}

// viewerUserID resolves an optional bearer for attribution only. Every failure
// is anonymous: recording a view gates nothing on the session, so a rejected or
// unverifiable one must leave the request untouched and fall back to the
// cookie. Handlers that already authenticate for an access decision reuse that
// session instead of calling this.
func (s *apiServer) viewerUserID(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	header http.Header,
) uuid.NullUUID {
	if _, hasBearer := auth.BearerTokenFromHeader(header); !hasBearer {
		return uuid.NullUUID{}
	}
	session, err := s.authenticateAccessToken(ctx, tenantCtx, header)
	if err != nil {
		s.logger.InfoContext(ctx, "view event: bearer session rejected, attributing anonymously",
			"code", connect.CodeOf(err).String(),
		)
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: session.User.ID, Valid: true}
}

// resolvedContentViewTarget is what content_events needs to file a view: the
// series it belongs to, and the episode when the view is of one episode rather
// than the series. Both come from the server's own catalog row, so an
// episode_view cannot be filed under a series the episode does not belong to.
type resolvedContentViewTarget struct {
	seriesID  uuid.UUID
	episodeID uuid.NullUUID
}

// resolveContentViewTarget mirrors resolveRatingTarget: every member-facing RPC
// that acts on a catalog entity starts from the public query, so a foreign,
// unpublished, or missing target is NotFound before anything is written.
func (s *apiServer) resolveContentViewTarget(
	ctx context.Context,
	tenantID uuid.UUID,
	target *publirav1.ContentViewTarget,
) (resolvedContentViewTarget, error) {
	if target == nil || strings.TrimSpace(target.PublicId) == "" {
		return resolvedContentViewTarget{}, connect.NewError(connect.CodeInvalidArgument, errors.New("target is required"))
	}
	publicID := strings.TrimSpace(target.PublicId)

	queries := s.queriesFor(ctx)
	switch target.Type {
	case publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_SERIES:
		seriesID, err := queries.GetPublishedSeriesIDByPublicID(ctx, dbmodels.GetPublishedSeriesIDByPublicIDParams{
			TenantID: tenantID,
			PublicID: publicID,
		})
		if err == nil {
			return resolvedContentViewTarget{seriesID: seriesID}, nil
		}
		if errors.Is(err, sql.ErrNoRows) {
			return resolvedContentViewTarget{}, connect.NewError(connect.CodeNotFound, errors.New("target not found"))
		}
		return resolvedContentViewTarget{}, s.internalDBError(ctx, "failed to get content view series target", err, "tenant_id", tenantID.String())
	case publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_EPISODE:
		row, err := queries.GetPublishedEpisodeByPublicIDForTenant(ctx, dbmodels.GetPublishedEpisodeByPublicIDForTenantParams{
			TenantID: tenantID,
			PublicID: publicID,
		})
		if err == nil {
			return resolvedContentViewTarget{
				seriesID:  row.SeriesID,
				episodeID: uuid.NullUUID{UUID: row.ID, Valid: true},
			}, nil
		}
		if errors.Is(err, sql.ErrNoRows) {
			return resolvedContentViewTarget{}, connect.NewError(connect.CodeNotFound, errors.New("target not found"))
		}
		return resolvedContentViewTarget{}, s.internalDBError(ctx, "failed to get content view episode target", err, "tenant_id", tenantID.String())
	default:
		return resolvedContentViewTarget{}, connect.NewError(connect.CodeInvalidArgument, errors.New("target type is invalid"))
	}
}

// RecordContentView records one soft PV for a page a reader opened.
//
// This is deliberately its own RPC rather than a side effect of the detail
// reads. Those reads are cached by their callers, and a cache fill runs without
// the reader: it carries neither the cookie nor the bearer, so every fill would
// mint a fresh actor and add a row no one read, while a cache hit would record
// nothing at all. Here the caller is the reader's own request.
//
// The target is resolved before anything is written, so an unpublished or
// foreign public ID is NotFound rather than a recorded view. Once the target
// resolves the recording itself reports nothing: a view is instrumentation, and
// a reader whose page rendered must not be told their view failed to store.
func (s *apiServer) RecordContentView(
	ctx context.Context,
	req *connect.Request[publirav1.RecordContentViewRequest],
) (*connect.Response[publirav1.RecordContentViewResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	target, err := s.resolveContentViewTarget(ctx, tenant.ID, req.Msg.Target)
	if err != nil {
		return nil, err
	}

	res := noStorePrivateResponse(&publirav1.RecordContentViewResponse{})
	viewerUserID := s.viewerUserID(ctx, req.Msg.Tenant, req.Header())
	s.instrumentViewEvent(ctx, res.Header(), req.Header(), tenant.ID, target.seriesID, target.episodeID, viewerUserID)
	return res, nil
}

// instrumentViewEvent is the entire soft PV side effect of one recorded view:
// resolve the actor, hand a freshly minted cookie back on the response, and
// record the debounced event. It reports nothing, because instrumentation must
// never fail the request it instruments.
func (s *apiServer) instrumentViewEvent(
	ctx context.Context,
	responseHeader http.Header,
	requestHeader http.Header,
	tenantID uuid.UUID,
	seriesID uuid.UUID,
	episodeID uuid.NullUUID,
	viewerUserID uuid.NullUUID,
) {
	actor, minted := resolveViewActor(viewerUserID, requestHeader)
	if minted != nil && responseHeader != nil {
		// Handed over even when the event below is skipped or deduped, so the
		// reader's next request is already attributable to the same actor.
		responseHeader.Add("Set-Cookie", minted.String())
	}
	if isPrefetchRequest(requestHeader) {
		// Debug rather than Info: a busy storefront prefetches constantly, and
		// this skip is the expected outcome rather than something to look into.
		s.logger.DebugContext(ctx, "skipped view event: prefetch request",
			viewEventLogAttrs(tenantID, seriesID, episodeID)...)
		return
	}
	s.recordViewEvent(ctx, tenantID, seriesID, episodeID, actor, time.Now().UTC())
}

func viewEventLogAttrs(tenantID, seriesID uuid.UUID, episodeID uuid.NullUUID) []any {
	eventType := "series_view"
	if episodeID.Valid {
		eventType = "episode_view"
	}
	attrs := []any{
		"event_type", eventType,
		"tenant_id", tenantID.String(),
		"series_id", seriesID.String(),
	}
	if episodeID.Valid {
		attrs = append(attrs, "episode_id", episodeID.UUID.String())
	}
	return attrs
}

// recordViewEvent writes one debounced soft PV. episodeID decides which event
// it is: an episode read records episode_view, a series read series_view.
//
// Nothing here can fail the read it instruments. Instrumentation that takes the
// page down with it is worse than instrumentation that loses a row, so every
// failure — an unresolvable actor, a broken insert — is logged and swallowed.
func (s *apiServer) recordViewEvent(
	ctx context.Context,
	tenantID uuid.UUID,
	seriesID uuid.UUID,
	episodeID uuid.NullUUID,
	actor viewActor,
	occurredAt time.Time,
) {
	logAttrs := viewEventLogAttrs(tenantID, seriesID, episodeID)

	if !actor.resolved() {
		s.logger.InfoContext(ctx, "skipped view event: actor could not be resolved", logAttrs...)
		return
	}
	eventID, err := uuid.NewV7()
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to allocate view event id", append(logAttrs, "error", err)...)
		return
	}

	bucket := viewDebounceBucket(occurredAt)
	if episodeID.Valid {
		_, err = s.queriesFor(ctx).InsertDebouncedEpisodeViewEvent(ctx, dbmodels.InsertDebouncedEpisodeViewEventParams{
			ID:             eventID,
			TenantID:       tenantID,
			UserID:         actor.userID,
			AnonymousID:    actor.anonymousID,
			SeriesID:       seriesID,
			EpisodeID:      episodeID.UUID,
			DebounceBucket: bucket,
			Payload:        softViewPayload(),
			OccurredAt:     occurredAt,
		})
	} else {
		_, err = s.queriesFor(ctx).InsertDebouncedSeriesViewEvent(ctx, dbmodels.InsertDebouncedSeriesViewEventParams{
			ID:             eventID,
			TenantID:       tenantID,
			UserID:         actor.userID,
			AnonymousID:    actor.anonymousID,
			SeriesID:       seriesID,
			DebounceBucket: bucket,
			Payload:        softViewPayload(),
			OccurredAt:     occurredAt,
		})
	}
	// ON CONFLICT DO NOTHING returns no rows: this actor is already counted in
	// this bucket, which is the debounce working rather than a failure.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.logger.ErrorContext(ctx, "failed to insert view event", append(logAttrs, "error", err)...)
	}
}
