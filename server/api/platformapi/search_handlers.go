package platformapi

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformsearch"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/secretupdate"
)

var searchEngineProto = map[platformsearch.Engine]publirasplatformv1.PlatformSearchEngine{
	platformsearch.EngineSQL:           publirasplatformv1.PlatformSearchEngine_PLATFORM_SEARCH_ENGINE_SQL,
	platformsearch.EngineOpenSearch:    publirasplatformv1.PlatformSearchEngine_PLATFORM_SEARCH_ENGINE_OPENSEARCH,
	platformsearch.EngineElasticsearch: publirasplatformv1.PlatformSearchEngine_PLATFORM_SEARCH_ENGINE_ELASTICSEARCH,
}

var searchBuildStateProto = map[platformsearch.BuildState]publirasplatformv1.PlatformSearchBuildState{
	platformsearch.Serving:     publirasplatformv1.PlatformSearchBuildState_PLATFORM_SEARCH_BUILD_STATE_SERVING,
	platformsearch.Building:    publirasplatformv1.PlatformSearchBuildState_PLATFORM_SEARCH_BUILD_STATE_BUILDING,
	platformsearch.BuildFailed: publirasplatformv1.PlatformSearchBuildState_PLATFORM_SEARCH_BUILD_STATE_FAILED,
}

// searchEngineFromProto names the stored engine a request asks for. A value
// this server does not know keeps its number, which the validation refuses
// alongside the names of every engine it does know.
func searchEngineFromProto(engine publirasplatformv1.PlatformSearchEngine) platformsearch.Engine {
	for stored, value := range searchEngineProto {
		if value == engine {
			return stored
		}
	}
	return platformsearch.Engine(engine.String())
}

func platformSearchSettingsToProto(stored platformsearch.Stored) *publirasplatformv1.PlatformSearchSettings {
	settings := &publirasplatformv1.PlatformSearchSettings{
		Engine:      searchEngineProto[stored.Engine],
		Url:         stored.URL,
		Index:       stored.Index,
		Username:    stored.Username,
		HasPassword: stored.HasPassword,
		Revision:    stored.Revision,
		Serving: &publirasplatformv1.PlatformSearchServing{
			Engine:   searchEngineProto[stored.Serving.Engine],
			Url:      stored.Serving.URL,
			Index:    stored.Serving.Index,
			Revision: stored.Serving.Revision,
		},
		BuildState:      searchBuildStateProto[stored.State],
		Analysis:        stored.EffectiveAnalysis(),
		DefaultAnalysis: stored.Engine.HasIndex() && stored.Analysis == "",
	}
	if !stored.Serving.Since.IsZero() {
		settings.Serving.Since = stored.Serving.Since.UTC().Format(time.RFC3339)
	}
	if stored.Failure != nil {
		settings.BuildFailure = &publirasplatformv1.PlatformSearchBuildFailure{
			Error:    stored.Failure.Error,
			FailedAt: stored.Failure.FailedAt.UTC().Format(time.RFC3339),
		}
	}
	return settings
}

func searchSettingsFromRow(row dbmodels.PlatformSearchConfig) *publirasplatformv1.PlatformSearchSettings {
	return platformSearchSettingsToProto(platformsearch.FromConfig(row))
}

// searchSettingsError maps what platformsearch refuses to this API's codes,
// naming the request field when the refusal has one.
func (s *platformServer) searchSettingsError(ctx context.Context, err error) error {
	if connectErr := rpcerrors.FromFieldError(err); connectErr != nil {
		return connectErr
	}
	if errors.Is(err, platformsearch.ErrConflict) {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	// The engine's own error stays in the log: it can name the URL.
	if errors.Is(err, platformsearch.ErrAnalysisUnchecked) {
		s.logger.WarnContext(ctx, "the search engine could not check the analysis", "error", err)
		return connect.NewError(connect.CodeUnavailable, platformsearch.ErrAnalysisUnchecked)
	}
	return s.internalDBError(ctx, "failed to access platform search config", err)
}

func (s *platformServer) GetPlatformSearchSettings(
	ctx context.Context,
	_ *connect.Request[publirasplatformv1.GetPlatformSearchSettingsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformSearchSettingsResponse], error) {
	row, found, err := platformsearch.Get(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get platform search config", err)
	}
	// Nothing saved is answered as the SQL engine at revision zero, which is
	// what every process searches with and what a save states when it expects
	// to create the row.
	stored := platformsearch.Unsaved()
	if found {
		stored = platformsearch.FromConfig(row)
	}
	return connect.NewResponse(&publirasplatformv1.GetPlatformSearchSettingsResponse{
		Settings: platformSearchSettingsToProto(stored),
	}), nil
}

func (s *platformServer) UpdatePlatformSearchSettings(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformSearchSettingsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformSearchSettingsResponse], error) {
	expectedRevision := req.Msg.GetExpectedRevision()
	params := platformsearch.SaveParams{
		Settings: platformsearch.Settings{
			Engine:   searchEngineFromProto(req.Msg.GetEngine()),
			URL:      req.Msg.GetUrl(),
			Index:    req.Msg.GetIndex(),
			Username: req.Msg.GetUsername(),
		},
		SecretMode:       secretupdate.Mode(req.Msg.GetPasswordUpdateMode()),
		Password:         req.Msg.GetPassword(),
		AnalysisMode:     platformsearch.AnalysisMode(req.Msg.GetAnalysisUpdateMode()),
		Analysis:         req.Msg.GetAnalysis(),
		ExpectedRevision: &expectedRevision,
	}
	if err := params.Validate(); err != nil {
		return nil, s.searchSettingsError(ctx, err)
	}
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}

	saved, err := platformsearch.Save(ctx, s.db, s.logger, s.encryptor, actor, params)
	if err != nil {
		return nil, s.searchSettingsError(ctx, err)
	}
	return connect.NewResponse(&publirasplatformv1.UpdatePlatformSearchSettingsResponse{
		Settings: searchSettingsFromRow(saved),
	}), nil
}

func (s *platformServer) TestPlatformSearchConnection(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.TestPlatformSearchConnectionRequest],
) (*connect.Response[publirasplatformv1.TestPlatformSearchConnectionResponse], error) {
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}

	tester := platformsearch.Tester{Secrets: s.encryptor, Probe: s.searchProbe, Recorder: s.recorder}
	result, err := tester.Test(ctx, s.queriesFor(ctx), actor, platformsearch.TestParams{
		Settings: platformsearch.Settings{
			Engine:   searchEngineFromProto(req.Msg.GetEngine()),
			URL:      req.Msg.GetUrl(),
			Username: req.Msg.GetUsername(),
		},
		SecretMode: secretupdate.Mode(req.Msg.GetPasswordUpdateMode()),
		Password:   req.Msg.GetPassword(),
	})
	if err != nil {
		return nil, s.searchSettingsError(ctx, err)
	}
	return connect.NewResponse(&publirasplatformv1.TestPlatformSearchConnectionResponse{
		Succeeded:                 result.Succeeded(),
		Reason:                    result.Reason,
		Product:                   result.Product,
		Version:                   result.Version,
		AnalysisKuromojiInstalled: result.KuromojiPresent,
		AnalysisIcuInstalled:      result.ICUPresent,
	}), nil
}
