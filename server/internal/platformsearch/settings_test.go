package platformsearch

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
)

func TestNormalizeGivesAnEngineWithAnIndexTheDefaultAlias(t *testing.T) {
	got := Normalize(Settings{Engine: " opensearch ", URL: " https://search.example.com ", Username: " publira "})
	want := Settings{Engine: EngineOpenSearch, URL: "https://search.example.com", Index: opensearchbackend.DefaultIndex, Username: "publira"}
	if got != want {
		t.Fatalf("Normalize = %+v, want %+v", got, want)
	}
	if got := Normalize(Settings{Engine: EngineSQL}); got != (Settings{Engine: EngineSQL}) {
		t.Fatalf("Normalize(sql) = %+v, want no index", got)
	}
}

func TestValidateRefusesSettingsNoProcessCouldSearchWith(t *testing.T) {
	for _, test := range []struct {
		name      string
		settings  Settings
		wantField string
		wantText  string
	}{
		{name: "an unknown engine", settings: Settings{Engine: "solr"}, wantField: FieldEngine, wantText: `"solr" names no search engine; the ones available are sql, opensearch, elasticsearch`},
		{name: "no engine", settings: Settings{}, wantField: FieldEngine, wantText: "the ones available are sql, opensearch, elasticsearch"},
		{name: "a URL on sql", settings: Settings{Engine: EngineSQL, URL: "http://search:9200"}, wantField: FieldURL},
		{name: "an index on sql", settings: Settings{Engine: EngineSQL, Index: "catalog"}, wantField: FieldIndex},
		{name: "a username on sql", settings: Settings{Engine: EngineSQL, Username: "publira"}, wantField: FieldUsername},
		{name: "no URL", settings: Settings{Engine: EngineOpenSearch, Index: "catalog"}, wantField: FieldURL},
		{name: "not an http URL", settings: Settings{Engine: EngineOpenSearch, URL: "search:9200", Index: "catalog"}, wantField: FieldURL},
		{name: "a URL that does not parse", settings: Settings{Engine: EngineOpenSearch, URL: "https://publira:secret@[search.example.com", Index: "catalog"}, wantField: FieldURL},
		{name: "a URL of another scheme", settings: Settings{Engine: EngineOpenSearch, URL: "opensearch://publira:secret@search.example.com", Index: "catalog"}, wantField: FieldURL},
		{name: "credentials in the URL", settings: Settings{Engine: EngineOpenSearch, URL: "https://publira:secret@search.example.com", Index: "catalog"}, wantField: FieldURL, wantText: "carries credentials"},
		{name: "credentials over http", settings: Settings{Engine: EngineOpenSearch, URL: "http://search:9200", Index: "catalog", Username: "publira"}, wantField: FieldUsername, wantText: "cleartext"},
		{name: "an uppercase alias", settings: Settings{Engine: EngineOpenSearch, URL: "http://search:9200", Index: "Catalog"}, wantField: FieldIndex},
		{name: "an alias starting with -", settings: Settings{Engine: EngineOpenSearch, URL: "http://search:9200", Index: "-catalog"}, wantField: FieldIndex},
		{name: "an alias with a space", settings: Settings{Engine: EngineOpenSearch, URL: "http://search:9200", Index: "the catalog"}, wantField: FieldIndex},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := Validate(test.settings)
			if got := fielderr.Field(err); got != test.wantField {
				t.Fatalf("Validate field = %q (%v), want %q", got, err, test.wantField)
			}
			if !strings.Contains(err.Error(), test.wantText) {
				t.Fatalf("Validate error = %q, want it to contain %q", err, test.wantText)
			}
			// The error reaches the console and the log, so it must not repeat
			// a credential the URL carried.
			if strings.Contains(err.Error(), "secret") {
				t.Fatalf("Validate error %q prints the password", err)
			}
		})
	}
}

func TestValidateAcceptsWhatEveryEngineSearchesWith(t *testing.T) {
	for _, settings := range []Settings{
		{Engine: EngineSQL},
		{Engine: EngineOpenSearch, URL: "http://opensearch:9200", Index: "publira-catalog"},
		{Engine: EngineOpenSearch, URL: "https://search.example.com/prefix", Index: "publira-staging.catalog", Username: "publira"},
	} {
		if err := Validate(settings); err != nil {
			t.Fatalf("Validate(%+v) = %v", settings, err)
		}
	}
}

func searchRow(revision, serving int64) dbmodels.PlatformSearchConfig {
	return dbmodels.PlatformSearchConfig{
		Engine:            string(EngineOpenSearch),
		Url:               sql.NullString{String: "https://search.example.com", Valid: true},
		IndexAlias:        sql.NullString{String: "publira-catalog", Valid: true},
		Username:          sql.NullString{String: "publira", Valid: true},
		PasswordEncrypted: sql.NullString{String: "sealed", Valid: true},
		Revision:          revision,
		ServingRevision:   serving,
		ServingEngine:     string(EngineSQL),
	}
}

func TestFromConfigTellsWhereTheSavedConfigurationStands(t *testing.T) {
	failedAt := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

	serving := searchRow(3, 3)
	if got := FromConfig(serving); got.State != Serving || got.Failure != nil {
		t.Fatalf("FromConfig(serving) = %+v, want Serving", got)
	}

	building := searchRow(3, 2)
	if got := FromConfig(building); got.State != Building || got.Failure != nil {
		t.Fatalf("FromConfig(building) = %+v, want Building", got)
	}

	failed := searchRow(3, 2)
	failed.BuildFailedRevision = sql.NullInt64{Int64: 3, Valid: true}
	failed.BuildError = sql.NullString{String: "unknown tokenizer", Valid: true}
	failed.BuildFailedAt = sql.NullTime{Time: failedAt, Valid: true}
	got := FromConfig(failed)
	if got.State != BuildFailed || got.Failure == nil || got.Failure.Error != "unknown tokenizer" || !got.Failure.FailedAt.Equal(failedAt) {
		t.Fatalf("FromConfig(failed) = %+v, want BuildFailed with the error", got)
	}
	if !got.HasPassword || got.Serving.Engine != EngineSQL {
		t.Fatalf("FromConfig(failed) = %+v, want the password saved and the search on sql", got)
	}
}

func TestEvaluateNamesWhatTheEngineLacks(t *testing.T) {
	complete := opensearchbackend.Probe{
		Product: opensearchbackend.ProductOpenSearch,
		Version: "3.9.0",
		Plugins: []string{opensearchbackend.PluginAnalysisICU, opensearchbackend.PluginAnalysisKuromoji},
	}
	for _, test := range []struct {
		name  string
		probe opensearchbackend.Probe
		err   error
		want  string
	}{
		{name: "both plugins", probe: complete},
		{name: "no answer", err: fmt.Errorf("%w: dial", opensearchbackend.ErrUnreachable), want: ReasonUnreachable},
		{name: "a context deadline", err: errors.New("context deadline exceeded"), want: ReasonUnreachable},
		{name: "credentials refused", err: fmt.Errorf("%w: 401", opensearchbackend.ErrUnauthorized), want: ReasonUnauthorized},
		{name: "not a search engine", err: fmt.Errorf("%w: 404", opensearchbackend.ErrUnexpectedAnswer), want: ReasonNotAnEngine},
		{name: "another product", probe: opensearchbackend.Probe{Product: opensearchbackend.ProductElasticsearch, Version: "9.1.5", Plugins: complete.Plugins}, want: ReasonWrongProduct},
		{name: "no ICU", probe: opensearchbackend.Probe{Product: opensearchbackend.ProductOpenSearch, Version: "3.9.0", Plugins: []string{opensearchbackend.PluginAnalysisKuromoji}}, want: ReasonMissingPlugin},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := evaluate(EngineOpenSearch, test.probe, test.err); got.Reason != test.want {
				t.Fatalf("evaluate = %+v, want reason %q", got, test.want)
			}
		})
	}
}

func TestTruncateKeepsARecordedErrorWhole(t *testing.T) {
	if got := truncate("short"); got != "short" {
		t.Fatalf("truncate = %q", got)
	}
	long := strings.Repeat("あ", maxBuildError)
	got := truncate(long)
	if len(got) > maxBuildError+len("…") || !strings.HasSuffix(got, "…") || strings.ContainsRune(got, '�') {
		t.Fatalf("truncate cut %d bytes into %d, want at most %d whole characters and an ellipsis", len(long), len(got), maxBuildError)
	}
}
