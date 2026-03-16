package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	_ "github.com/jackc/pgx/v5/stdlib"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const defaultDBURL = "postgres://postgres:password@db:5432/kariplatform?sslmode=disable"

type apiServer struct {
	queries *dbmodels.Queries
}

func tenantPublicIDFromContext(ctx *publirav1.TenantContext) (string, error) {
	if ctx == nil || strings.TrimSpace(ctx.TenantPublicId) == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant context is required"))
	}
	return ctx.TenantPublicId, nil
}

func (s *apiServer) tenantByContext(ctx context.Context, tenantCtx *publirav1.TenantContext) (dbmodels.Tenant, error) {
	tenantPublicID, err := tenantPublicIDFromContext(tenantCtx)
	if err != nil {
		return dbmodels.Tenant{}, err
	}
	tenant, err := s.queries.GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Tenant{}, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return dbmodels.Tenant{}, connect.NewError(connect.CodeInternal, err)
	}
	return tenant, nil
}

func toProtoSeries(row dbmodels.GetSeriesByPublicIDForTenantRow) *publirav1.Series {
	series := &publirav1.Series{
		PublicId: row.PublicID,
		Title:    row.Title,
	}
	if row.Synopsis.Valid {
		series.Synopsis = row.Synopsis.String
	}
	return series
}

func toProtoEpisode(row dbmodels.GetEpisodeByPublicIDForTenantRow) *publirav1.Episode {
	episode := &publirav1.Episode{
		PublicId:   row.PublicID,
		Title:      row.Title,
		OrderIndex: row.OrderIndex,
		Price:      row.Price,
		Status:     row.Status,
	}
	if row.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = row.ReadingPeriodHours.Int32
	}
	if row.ScheduledAt.Valid {
		episode.ScheduledAt = row.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if row.PublishedAt.Valid {
		episode.PublishedAt = row.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	return episode
}

func generatePublicID() string {
	raw := strings.ReplaceAll(uuid.NewString(), "-", "")
	return strings.ToUpper(raw[:12])
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func verifyPassword(password, storedHash string) bool {
	if bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password)) == nil {
		return true
	}
	return storedHash == password
}

func parseScheduledAtOrZero(value string) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}
	t, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("scheduled_at must be RFC3339"))
	}
	return sql.NullTime{Time: t, Valid: true}, nil
}

func (s *apiServer) ListPublishedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedSeriesRequest],
) (*connect.Response[publirav1.ListPublishedSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	rows, err := s.queries.ListActiveSeries(ctx, tenant.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirav1.Series, 0, len(rows))
	for _, row := range rows {
		item := &publirav1.Series{
			PublicId: row.PublicID,
			Title:    row.Title,
		}
		if row.Synopsis.Valid {
			item.Synopsis = row.Synopsis.String
		}
		items = append(items, item)
	}
	res := connect.NewResponse(&publirav1.ListPublishedSeriesResponse{Series: items})
	return res, nil
}

func (s *apiServer) GetSeriesDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetSeriesDetailRequest],
) (*connect.Response[publirav1.GetSeriesDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queries.GetSeriesDetail(ctx, dbmodels.GetSeriesDetailParams{
		PublicID: req.Msg.PublicId,
		TenantID: tenant.ID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	res := connect.NewResponse(&publirav1.GetSeriesDetailResponse{
		Series: &publirav1.Series{
			PublicId: row.PublicID,
			Title:    row.Title,
		},
		Episodes: []*publirav1.Episode{},
	})
	if row.Synopsis.Valid {
		res.Msg.Series.Synopsis = row.Synopsis.String
	}
	if row.LabelName.Valid {
		res.Msg.Series.Label = &publirav1.Label{Name: row.LabelName.String}
	}
	return res, nil
}

func (s *apiServer) GetEpisodeDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetEpisodeDetailRequest],
) (*connect.Response[publirav1.GetEpisodeDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.PublicId,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	res := connect.NewResponse(&publirav1.GetEpisodeDetailResponse{
		Episode: toProtoEpisode(row),
	})
	return res, nil
}

func (s *apiServer) CreateSeries(
	ctx context.Context,
	req *connect.Request[publirav1.CreateSeriesRequest],
) (*connect.Response[publirav1.CreateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	labelID := uuid.NullUUID{}
	if strings.TrimSpace(req.Msg.LabelPublicId) != "" {
		label, err := s.queries.GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{
			TenantID: tenant.ID,
			PublicID: req.Msg.LabelPublicId,
		})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("label not found"))
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		labelID = uuid.NullUUID{UUID: label.ID, Valid: true}
	}
	base, err := s.queries.CreateSeriesBase(ctx, dbmodels.CreateSeriesBaseParams{
		ID:       uuid.New(),
		TenantID: tenant.ID,
		LabelID:  labelID,
		PublicID: generatePublicID(),
		Title:    req.Msg.Title,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queries.UpsertSeriesListing(ctx, dbmodels.UpsertSeriesListingParams{
		SeriesID:           base.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{},
		IsPublished:        sql.NullBool{Bool: req.Msg.IsPublished, Valid: true},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	res := connect.NewResponse(&publirav1.CreateSeriesResponse{
		Series: &publirav1.Series{
			PublicId: base.PublicID,
			Title:    base.Title,
			Synopsis: req.Msg.Synopsis,
		},
	})
	return res, nil
}

func (s *apiServer) UpdateSeries(
	ctx context.Context,
	req *connect.Request[publirav1.UpdateSeriesRequest],
) (*connect.Response[publirav1.UpdateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	current, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.PublicId,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queries.UpdateSeriesBase(ctx, dbmodels.UpdateSeriesBaseParams{
		ID:      current.ID,
		Title:   req.Msg.Title,
		LabelID: uuid.NullUUID{},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queries.UpsertSeriesListing(ctx, dbmodels.UpsertSeriesListingParams{
		SeriesID:           current.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{},
		IsPublished:        sql.NullBool{Bool: req.Msg.IsPublished, Valid: true},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	updated, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.PublicId,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	res := connect.NewResponse(&publirav1.UpdateSeriesResponse{Series: toProtoSeries(updated)})
	return res, nil
}

func (s *apiServer) ListSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListSeriesRequest],
) (*connect.Response[publirav1.ListSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := req.Msg.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := req.Msg.Offset
	if offset < 0 {
		offset = 0
	}
	rows, err := s.queries.ListSeriesByTenant(ctx, dbmodels.ListSeriesByTenantParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirav1.Series, 0, len(rows))
	for _, row := range rows {
		item := &publirav1.Series{PublicId: row.PublicID, Title: row.Title}
		if row.Synopsis.Valid {
			item.Synopsis = row.Synopsis.String
		}
		items = append(items, item)
	}
	return connect.NewResponse(&publirav1.ListSeriesResponse{Series: items}), nil
}

func (s *apiServer) GetSeries(
	ctx context.Context,
	req *connect.Request[publirav1.GetSeriesRequest],
) (*connect.Response[publirav1.GetSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.GetSeriesResponse{Series: toProtoSeries(row)}), nil
}

func (s *apiServer) CreateEpisode(
	ctx context.Context,
	req *connect.Request[publirav1.CreateEpisodeRequest],
) (*connect.Response[publirav1.CreateEpisodeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	series, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.SeriesPublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	base, err := s.queries.CreateEpisodeBase(ctx, dbmodels.CreateEpisodeBaseParams{
		ID:         uuid.New(),
		SeriesID:   series.ID,
		PublicID:   generatePublicID(),
		Title:      req.Msg.Title,
		OrderIndex: req.Msg.OrderIndex,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	scheduledAt, err := parseScheduledAtOrZero(req.Msg.ScheduledAt)
	if err != nil {
		return nil, err
	}
	status := "draft"
	if scheduledAt.Valid {
		status = "scheduled"
	}
	listing, err := s.queries.UpsertEpisodeListing(ctx, dbmodels.UpsertEpisodeListingParams{
		EpisodeID:          base.ID,
		Price:              req.Msg.Price,
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
		Status:             status,
		ScheduledAt:        scheduledAt,
		PublishedAt:        sql.NullTime{},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	episode := &publirav1.Episode{
		PublicId:   base.PublicID,
		Title:      base.Title,
		OrderIndex: base.OrderIndex,
		Price:      listing.Price,
		Status:     listing.Status,
	}
	if listing.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = listing.ReadingPeriodHours.Int32
	}
	if listing.ScheduledAt.Valid {
		episode.ScheduledAt = listing.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if listing.PublishedAt.Valid {
		episode.PublishedAt = listing.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	return connect.NewResponse(&publirav1.CreateEpisodeResponse{Episode: episode}), nil
}

func (s *apiServer) UpdateEpisodePublishSchedule(
	ctx context.Context,
	req *connect.Request[publirav1.UpdateEpisodePublishScheduleRequest],
) (*connect.Response[publirav1.UpdateEpisodePublishScheduleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	scheduledAt, err := parseScheduledAtOrZero(req.Msg.ScheduledAt)
	if err != nil {
		return nil, err
	}
	err = s.queries.UpdateEpisodePublishScheduleByPublicIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByPublicIDForTenantParams{
		TenantID:    tenant.ID,
		PublicID:    req.Msg.EpisodePublicId,
		ScheduledAt: scheduledAt,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	ep, err := s.queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.EpisodePublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.UpdateEpisodePublishScheduleResponse{Episode: toProtoEpisode(ep)}), nil
}

func (s *apiServer) CreateSession(
	ctx context.Context,
	req *connect.Request[publirav1.CreateSessionRequest],
) (*connect.Response[publirav1.CreateSessionResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	user, err := s.queries.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{TenantID: tenant.ID, Email: req.Msg.Email})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !verifyPassword(req.Msg.Password, user.PasswordHash) {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
	}
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	sessionToken := hex.EncodeToString(rawToken)
	createdSession, err := s.queries.CreateSession(ctx, dbmodels.CreateSessionParams{
		ID:        uuid.New(),
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: hashToken(sessionToken),
		ExpiresAt: time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &publirav1.CreateSessionResponse{
		User: &publirav1.User{
			PublicId: user.PublicID,
			Name:     user.Name,
			Role:     user.Role,
		},
		Session: &publirav1.Session{
			SessionId: sessionToken,
			ExpiresAt: createdSession.ExpiresAt.UTC().Format(time.RFC3339),
		},
	}
	return connect.NewResponse(resp), nil
}

func (s *apiServer) DeleteSession(
	ctx context.Context,
	req *connect.Request[publirav1.DeleteSessionRequest],
) (*connect.Response[publirav1.DeleteSessionResponse], error) {
	tokenHash := hashToken(req.Msg.SessionId)
	session, err := s.queries.GetSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewResponse(&publirav1.DeleteSessionResponse{}), nil
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queries.RevokeSession(ctx, session.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.DeleteSessionResponse{}), nil
}

func (s *apiServer) GetMe(
	ctx context.Context,
	req *connect.Request[publirav1.GetMeRequest],
) (*connect.Response[publirav1.GetMeResponse], error) {
	session, err := s.queries.GetSessionByTokenHash(ctx, hashToken(req.Msg.SessionId))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid session"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	user, err := s.queries.GetUserByID(ctx, session.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("user not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.GetMeResponse{User: &publirav1.User{
		PublicId: user.PublicID,
		Name:     user.Name,
		Role:     user.Role,
	}}), nil
}

func main() {
	dbURL := os.Getenv("DB_URL")
	if strings.TrimSpace(dbURL) == "" {
		dbURL = defaultDBURL
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		log.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("failed to ping db: %v", err)
	}

	server := &apiServer{queries: dbmodels.New(db)}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	path, handler := publirav1connect.NewCatalogServiceHandler(server)
	mux.Handle(path, handler)
	adminPath, adminHandler := publirav1connect.NewAdminSeriesServiceHandler(server)
	mux.Handle(adminPath, adminHandler)
	authPath, authHandler := publirav1connect.NewAuthServiceHandler(server)
	mux.Handle(authPath, authHandler)

	log.Println("Starting API server on :8080...")
	err = http.ListenAndServe(
		":8080",
		h2c.NewHandler(mux, &http2.Server{}),
	)
	if err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
