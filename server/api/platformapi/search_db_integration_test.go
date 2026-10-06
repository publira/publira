package platformapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformsearch"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

// recordingProbe answers with the probe it was given and keeps the
// configuration it was asked about.
type recordingProbe struct {
	probe opensearchbackend.Probe
	err   error
	asked []opensearchbackend.Config
}

func (r *recordingProbe) Probe(_ context.Context, cfg opensearchbackend.Config) (opensearchbackend.Probe, error) {
	r.asked = append(r.asked, cfg)
	return r.probe, r.err
}

func completeOpenSearch() opensearchbackend.Probe {
	return opensearchbackend.Probe{
		Product: opensearchbackend.ProductOpenSearch,
		Version: "3.9.0",
		Plugins: []string{opensearchbackend.PluginAnalysisICU, opensearchbackend.PluginAnalysisKuromoji},
	}
}

func newSearchClient(t *testing.T, probe *recordingProbe) (
	publirasplatformv1connect.PlatformSearchSettingsServiceClient,
	*testutil.PostgresEnv,
	testutil.PlatformOperator,
) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)

	api := newAPI(db, dbmodels.New(db), slog.Default(), storageTestEncryptor(t), nil, testutil.TokenManager(), nil, openMailGuard(), nil)
	api.server.searchProbe = probe.Probe
	ts := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(ts.Close)

	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	return publirasplatformv1connect.NewPlatformSearchSettingsServiceClient(ts.Client(), ts.URL), pg, operator
}

func searchUpdateRequest(revision int64) *publirasplatformv1.UpdatePlatformSearchSettingsRequest {
	return &publirasplatformv1.UpdatePlatformSearchSettingsRequest{
		Engine:             publirasplatformv1.PlatformSearchEngine_PLATFORM_SEARCH_ENGINE_OPENSEARCH,
		Url:                "https://search.example.com",
		Username:           "publira",
		PasswordUpdateMode: publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
		Password:           "the-search-password",
		ExpectedRevision:   revision,
	}
}

func updateSearchSettings(
	client publirasplatformv1connect.PlatformSearchSettingsServiceClient,
	operator testutil.PlatformOperator,
	req *publirasplatformv1.UpdatePlatformSearchSettingsRequest,
) (*publirasplatformv1.PlatformSearchSettings, error) {
	resp, err := client.UpdatePlatformSearchSettings(context.Background(), authedStorageRequest(operator, req))
	if err != nil {
		return nil, err
	}
	return resp.Msg.GetSettings(), nil
}

// An installation that has saved nothing searches on SQL, which the read says
// at revision zero rather than by failing.
func TestDBGetPlatformSearchSettingsAnswersTheSQLEngine(t *testing.T) {
	client, _, operator := newSearchClient(t, &recordingProbe{probe: completeOpenSearch()})

	resp, err := client.GetPlatformSearchSettings(context.Background(), authedStorageRequest(operator, &publirasplatformv1.GetPlatformSearchSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSearchSettings: %v", err)
	}
	settings := resp.Msg.GetSettings()
	if settings.GetRevision() != 0 || settings.GetEngine() != publirasplatformv1.PlatformSearchEngine_PLATFORM_SEARCH_ENGINE_SQL {
		t.Fatalf("settings = %+v, want sql at revision zero", settings)
	}
	if settings.GetServing().GetEngine() != publirasplatformv1.PlatformSearchEngine_PLATFORM_SEARCH_ENGINE_SQL ||
		settings.GetBuildState() != publirasplatformv1.PlatformSearchBuildState_PLATFORM_SEARCH_BUILD_STATE_SERVING {
		t.Fatalf("settings = %+v, want the search serving from sql", settings)
	}
}

// A save of an engine the search has not used reports the build it is waiting
// on, keeps the password out of the answer and out of the row in the clear, and
// files its audit entry.
func TestDBUpdatePlatformSearchSettingsSavesAndReportsTheBuildDue(t *testing.T) {
	client, pg, operator := newSearchClient(t, &recordingProbe{probe: completeOpenSearch()})

	saved, err := updateSearchSettings(client, operator, searchUpdateRequest(0))
	if err != nil {
		t.Fatalf("UpdatePlatformSearchSettings: %v", err)
	}
	if saved.GetRevision() != 1 || saved.GetIndex() != opensearchbackend.DefaultIndex || !saved.GetHasPassword() {
		t.Fatalf("saved = %+v, want revision 1 on the default alias with a password", saved)
	}
	if saved.GetBuildState() != publirasplatformv1.PlatformSearchBuildState_PLATFORM_SEARCH_BUILD_STATE_BUILDING ||
		saved.GetServing().GetEngine() != publirasplatformv1.PlatformSearchEngine_PLATFORM_SEARCH_ENGINE_SQL {
		t.Fatalf("saved = %+v, want a build due and the search still on sql", saved)
	}

	var ciphertext string
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT password_encrypted FROM platform_search_config`).Scan(&ciphertext); err != nil {
		t.Fatalf("read the stored password: %v", err)
	}
	if !secretcrypto.IsEncryptedEnvelope(ciphertext) {
		t.Fatalf("the stored password is %q, want an encrypted envelope", ciphertext)
	}
	if got := countAuditActions(t, pg, "platform_search_settings_updated"); got != 1 {
		t.Fatalf("audit entries = %d, want 1", got)
	}

	// A failed build is reported with what went wrong.
	if _, err := dbmodels.New(pg.OpenContentStatsDB(t)).RecordPlatformSearchBuildFailure(context.Background(), dbmodels.RecordPlatformSearchBuildFailureParams{
		BuildError: "unknown tokenizer type [kuromoji_tokenizer]",
		Revision:   1,
	}); err != nil {
		t.Fatalf("record a failed build: %v", err)
	}
	resp, err := client.GetPlatformSearchSettings(context.Background(), authedStorageRequest(operator, &publirasplatformv1.GetPlatformSearchSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSearchSettings: %v", err)
	}
	got := resp.Msg.GetSettings()
	if got.GetBuildState() != publirasplatformv1.PlatformSearchBuildState_PLATFORM_SEARCH_BUILD_STATE_FAILED ||
		!strings.Contains(got.GetBuildFailure().GetError(), "kuromoji_tokenizer") || got.GetBuildFailure().GetFailedAt() == "" {
		t.Fatalf("settings = %+v, want the failed build reported", got)
	}
}

// An engine the server does not know is refused on save, naming every engine
// it does, and so is a save based on a revision the row has moved past.
func TestDBUpdatePlatformSearchSettingsRefusesAnUnknownEngineAndAStaleRevision(t *testing.T) {
	client, _, operator := newSearchClient(t, &recordingProbe{probe: completeOpenSearch()})

	unknown := searchUpdateRequest(0)
	unknown.Engine = publirasplatformv1.PlatformSearchEngine(99)
	_, err := updateSearchSettings(client, operator, unknown)
	assertFieldViolation(t, err, platformsearch.FieldEngine)
	if !strings.Contains(err.Error(), "sql, opensearch") {
		t.Fatalf("error = %v, want every engine named", err)
	}

	if _, err := updateSearchSettings(client, operator, searchUpdateRequest(0)); err != nil {
		t.Fatalf("UpdatePlatformSearchSettings: %v", err)
	}
	stale := searchUpdateRequest(0)
	stale.Url = "https://other.example.com"
	if _, err := updateSearchSettings(client, operator, stale); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("save at a stale revision = %v, want failed_precondition", err)
	}

	http := searchUpdateRequest(1)
	http.Url = "http://search.example.com"
	_, err = updateSearchSettings(client, operator, http)
	assertFieldViolation(t, err, platformsearch.FieldUsername)
}

// The test asks the engine the request names with the password the request
// states, or with the stored one when it states none, and reports what it
// found.
func TestDBTestPlatformSearchConnectionUsesTheStoredPassword(t *testing.T) {
	probe := &recordingProbe{probe: completeOpenSearch()}
	client, pg, operator := newSearchClient(t, probe)
	if _, err := updateSearchSettings(client, operator, searchUpdateRequest(0)); err != nil {
		t.Fatalf("UpdatePlatformSearchSettings: %v", err)
	}

	resp, err := client.TestPlatformSearchConnection(context.Background(), authedStorageRequest(operator, &publirasplatformv1.TestPlatformSearchConnectionRequest{
		Engine:             publirasplatformv1.PlatformSearchEngine_PLATFORM_SEARCH_ENGINE_OPENSEARCH,
		Url:                "https://search.example.com",
		Username:           "publira",
		PasswordUpdateMode: publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED,
	}))
	if err != nil {
		t.Fatalf("TestPlatformSearchConnection: %v", err)
	}
	if !resp.Msg.GetSucceeded() || resp.Msg.GetProduct() != opensearchbackend.ProductOpenSearch || !resp.Msg.GetAnalysisKuromojiInstalled() || !resp.Msg.GetAnalysisIcuInstalled() {
		t.Fatalf("response = %+v, want OpenSearch with both plugins", resp.Msg)
	}
	if len(probe.asked) != 1 || probe.asked[0].Password != "the-search-password" || probe.asked[0].Username != "publira" {
		t.Fatalf("asked = %v, want the stored credential", probe.asked)
	}

	probe.probe.Plugins = []string{opensearchbackend.PluginAnalysisKuromoji}
	resp, err = client.TestPlatformSearchConnection(context.Background(), authedStorageRequest(operator, &publirasplatformv1.TestPlatformSearchConnectionRequest{
		Engine: publirasplatformv1.PlatformSearchEngine_PLATFORM_SEARCH_ENGINE_OPENSEARCH,
		Url:    "http://search.example.com",
	}))
	if err != nil {
		t.Fatalf("TestPlatformSearchConnection: %v", err)
	}
	if resp.Msg.GetSucceeded() || resp.Msg.GetReason() != platformsearch.ReasonMissingPlugin || resp.Msg.GetAnalysisIcuInstalled() {
		t.Fatalf("response = %+v, want the missing plugin reported", resp.Msg)
	}
	if got := countAuditActions(t, pg, "platform_search_connection_tested"); got != 2 {
		t.Fatalf("audit entries = %d, want one per test", got)
	}
}

func countAuditActions(t *testing.T, pg *testutil.PostgresEnv, action string) int {
	t.Helper()
	var n int
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT count(*) FROM platform_audit_logs WHERE action = $1`, action).Scan(&n); err != nil {
		t.Fatalf("count audit entries: %v", err)
	}
	return n
}
