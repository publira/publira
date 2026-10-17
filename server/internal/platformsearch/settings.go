package platformsearch

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/locale"
)

// Engine is the stored name of a search engine.
type Engine string

const (
	// EngineSQL is a substring match in PostgreSQL. It needs nothing beside
	// the database, keeps no index, and is what an install searches with until
	// it saves another engine.
	EngineSQL Engine = "sql"
	// EngineOpenSearch is an OpenSearch node with the plugins its analysis is
	// built on, which for the default one is none.
	EngineOpenSearch Engine = "opensearch"
	// EngineElasticsearch is an Elasticsearch node with the same plugins,
	// which the OpenSearch backend searches and writes unchanged: the index
	// definition, the queries, the bulk writes, and the alias swaps are common
	// to both engines. The value is a promise that the backend is tested
	// against Elasticsearch as well.
	EngineElasticsearch Engine = "elasticsearch"
)

// Engines lists every engine a save accepts, in the order an error names them.
var Engines = []Engine{EngineSQL, EngineOpenSearch, EngineElasticsearch}

// Known reports whether e is one of [Engines].
func (e Engine) Known() bool {
	for _, known := range Engines {
		if e == known {
			return true
		}
	}
	return false
}

// HasIndex reports whether the engine keeps an index of its own, which every
// engine but SQL does.
func (e Engine) HasIndex() bool {
	return e != EngineSQL
}

// The fields a save or a test is refused over.
const (
	FieldEngine             = "engine"
	FieldURL                = "url"
	FieldIndex              = "index"
	FieldUsername           = "username"
	FieldPassword           = "password"
	FieldPasswordUpdateMode = "password_update_mode"
	FieldExpectedRevision   = "expected_revision"
	FieldAnalysis           = "analysis"
	FieldAnalysisUpdateMode = "analysis_update_mode"
	// FieldLocaleAnalyses is the list of changes to single languages'
	// analyses. A refusal of one of them names its place in the list, as
	// [LocaleAnalysisField] spells it.
	FieldLocaleAnalyses = "locale_analyses"
)

// LocaleAnalysisField names field of the change at index of the list
// [FieldLocaleAnalyses] names: locale_analyses[1].analysis.
func LocaleAnalysisField(index int, field string) string {
	return fmt.Sprintf("%s[%d].%s", FieldLocaleAnalyses, index, field)
}

var (
	errURLRequired       = errors.New("a URL is required for this engine")
	errNotHTTPURL        = errors.New("the URL is not an http:// or https:// URL")
	errURLCredentials    = errors.New("the URL carries credentials; give the username and the password on their own instead")
	errSQLTakesNoURL     = errors.New("the sql engine connects to nothing beside the database and takes no URL")
	errSQLTakesNoIndex   = errors.New("the sql engine keeps no index")
	errSQLTakesNoUser    = errors.New("the sql engine connects to nothing beside the database and takes no credentials")
	errCredentialsInHTTP = errors.New("credentials need an https:// URL; over http:// they would cross the network in cleartext")
	errIndexInvalid      = errors.New("the index alias is not a name the engine accepts: lowercase, without spaces, and not starting with -, _, or +")

	errSQLTakesNoAnalysis  = errors.New("the sql engine keeps no index to analyze")
	errInvalidAnalysisMode = errors.New("invalid analysis update mode")
	errLocaleNamedTwice    = errors.New("the language is given more than one analysis change")

	// ErrUsernameRequired refuses a password stated without the username it
	// belongs to.
	ErrUsernameRequired = errors.New("a password needs the username it belongs to")
	// ErrPasswordRequired refuses a username saved without a password.
	ErrPasswordRequired = errors.New("a username needs its password")
	// ErrUsernameChanged refuses to keep the stored password under a username
	// other than the one it was stored with.
	ErrUsernameChanged = errors.New("the saved password belongs to another username; give the password as well")
	// ErrSecretManagerUnavailable is a password to encrypt or decrypt in a
	// process started without the keys that do it.
	ErrSecretManagerUnavailable = errors.New("the search engine has a password, but this process has no secret encryption keys to encrypt or decrypt it")
)

// UnknownEngineError refuses an engine no process knows, naming the ones it
// does.
func UnknownEngineError(name string) error {
	names := make([]string, len(Engines))
	for i, engine := range Engines {
		names[i] = string(engine)
	}
	return &fielderr.Invalid{Field: FieldEngine, Err: fmt.Errorf("%q names no search engine; the ones available are %s", name, strings.Join(names, ", "))}
}

// UnknownLocaleError refuses an analysis given for a language the catalog keeps
// no index for, naming the ones it does.
func UnknownLocaleError(name string) error {
	return fmt.Errorf("%q names no language the catalog keeps an index for; the ones it does are %s", name, strings.Join(IndexLocales, ", "))
}

// LocaleError is a refusal of the analysis given for one language, which it
// names.
type LocaleError struct {
	Locale string
	Err    error
}

func (e *LocaleError) Error() string { return e.Locale + ": " + e.Err.Error() }

func (e *LocaleError) Unwrap() error { return e.Err }

// Settings is a saved configuration without its password.
type Settings struct {
	Engine Engine
	// URL and Index are empty on the SQL engine.
	URL   string
	Index string
	// Username is empty where the engine is reached without credentials.
	Username string
}

// Normalize trims every value and gives an engine with an index the default
// alias when it names none.
func Normalize(s Settings) Settings {
	s = Settings{
		Engine:   Engine(strings.TrimSpace(string(s.Engine))),
		URL:      strings.TrimSpace(s.URL),
		Index:    strings.TrimSpace(s.Index),
		Username: strings.TrimSpace(s.Username),
	}
	if s.Engine.HasIndex() && s.Index == "" {
		s.Index = opensearchbackend.DefaultIndex
	}
	return s
}

// Validate refuses settings no process could search with. Its errors never
// print the URL, which may carry the credentials it is refused for.
func Validate(s Settings) error {
	if !s.Engine.Known() {
		return UnknownEngineError(string(s.Engine))
	}
	if !s.Engine.HasIndex() {
		switch {
		case s.URL != "":
			return &fielderr.Invalid{Field: FieldURL, Err: errSQLTakesNoURL}
		case s.Index != "":
			return &fielderr.Invalid{Field: FieldIndex, Err: errSQLTakesNoIndex}
		case s.Username != "":
			return &fielderr.Invalid{Field: FieldUsername, Err: errSQLTakesNoUser}
		}
		return nil
	}
	if s.URL == "" {
		return &fielderr.Invalid{Field: FieldURL, Err: errURLRequired}
	}
	parsed, err := url.Parse(s.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return &fielderr.Invalid{Field: FieldURL, Err: errNotHTTPURL}
	}
	if parsed.User != nil {
		return &fielderr.Invalid{Field: FieldURL, Err: errURLCredentials}
	}
	if s.Username != "" && parsed.Scheme != "https" {
		return &fielderr.Invalid{Field: FieldUsername, Err: errCredentialsInHTTP}
	}
	if !validIndex(s.Index) {
		return &fielderr.Invalid{Field: FieldIndex, Err: errIndexInvalid}
	}
	return nil
}

// validIndex holds the rules both engines name an index or an alias by. The
// rebuild names its indices after the alias, so the alias must be one that
// keeps them valid.
func validIndex(name string) bool {
	if name == "" || name == "." || name == ".." || len(name) > 200 || strings.ContainsAny(name[:1], "-_+") {
		return false
	}
	for _, r := range name {
		if r >= 'A' && r <= 'Z' || strings.ContainsRune(` "*\<|,>/?#:`, r) {
			return false
		}
	}
	return true
}

// Target is where a configuration's documents are: the engine, and on an
// engine with an index, the URL and the alias. Two configurations with the
// same target share their index whatever their credentials.
type Target struct {
	Engine Engine
	URL    string
	Index  string
}

// Target is the target s searches.
func (s Settings) Target() Target {
	return Target{Engine: s.Engine, URL: s.URL, Index: s.Index}
}

// BuildState is where the saved configuration stands against the serving one.
type BuildState int

const (
	// Serving is a saved configuration the search answers from.
	Serving BuildState = iota + 1
	// Building is a saved configuration whose index the worker has yet to
	// build.
	Building
	// BuildFailed is a saved configuration whose last build failed.
	BuildFailed
)

// ServingSettings is the configuration the search answers from.
type ServingSettings struct {
	Settings
	// Analysis is what its indices were built with, empty for the default,
	// and LocaleAnalyses what the indices of single languages were built with
	// instead.
	Analysis       string
	LocaleAnalyses map[string]string
	// Revision is the saved revision it was saved at, zero for the SQL engine
	// of a row that has never served another.
	Revision int64
	// Since is when the search moved onto it, zero at revision zero.
	Since time.Time
	// Locales are the languages its catalog indices were built for, empty on
	// the SQL engine and for the one index of an install that predates
	// per-language indices.
	Locales []string
	// DefaultAnalysisVersion is the version of the default analysis its
	// indices were built with, zero on the SQL engine and for indices built
	// before the version was recorded.
	DefaultAnalysisVersion int32
}

// IndexLocales are the languages a build makes a catalog index for: every
// locale a reader can search in. A serving configuration whose indices were
// built for others has a build due, so a release that adds a locale, or the
// one that brought per-language indices to an install serving a single one,
// gets the indices it searches without an operator rebuilding them.
var IndexLocales = locale.Supported

// indicesCurrent reports whether the configuration keeps no index, or keeps
// one for each of IndexLocales and no other, each built from the definition it
// names: an index built from the default was built from the one this server
// ships, which [opensearchbackend.DefaultAnalysisVersion] names.
func (s ServingSettings) indicesCurrent() bool {
	if !s.Engine.HasIndex() {
		return true
	}
	usesDefault := slices.ContainsFunc(IndexLocales, func(locale string) bool {
		return analysisFor(s.Analysis, s.LocaleAnalyses, locale) == ""
	})
	return slices.Equal(s.Locales, IndexLocales) &&
		(!usesDefault || s.DefaultAnalysisVersion == opensearchbackend.DefaultAnalysisVersion)
}

// BuildFailure is the last build of the saved revision that failed.
type BuildFailure struct {
	Error    string
	FailedAt time.Time
}

// Stored is a saved row as a reader may see it, without either password.
type Stored struct {
	Settings
	// Analysis is the saved settings.analysis of the catalog index, as
	// [opensearchbackend.ParseAnalysis] answered it, and empty for the
	// default, which is all the SQL engine keeps.
	Analysis string
	// LocaleAnalyses are the saved definitions of single languages' indices,
	// by locale, in place of Analysis. The SQL engine keeps none.
	LocaleAnalyses map[string]string
	HasPassword    bool
	Revision       int64
	Serving        ServingSettings
	State          BuildState
	// Failure is set in the BuildFailed state and only then.
	Failure *BuildFailure
}

// FromConfig reads a saved row.
func FromConfig(row dbmodels.PlatformSearchConfig) Stored {
	stored := Stored{
		Settings: Settings{
			Engine:   Engine(row.Engine),
			URL:      row.Url.String,
			Index:    row.IndexAlias.String,
			Username: row.Username.String,
		},
		Analysis:       row.Analysis.String,
		LocaleAnalyses: decodeLocaleAnalyses(row.LocaleAnalyses.String),
		HasPassword:    strings.TrimSpace(row.PasswordEncrypted.String) != "",
		Revision:       row.Revision,
		Serving: ServingSettings{
			Settings: Settings{
				Engine:   Engine(row.ServingEngine),
				URL:      row.ServingUrl.String,
				Index:    row.ServingIndexAlias.String,
				Username: row.ServingUsername.String,
			},
			Analysis:               row.ServingAnalysis.String,
			LocaleAnalyses:         decodeLocaleAnalyses(row.ServingLocaleAnalyses.String),
			Revision:               row.ServingRevision,
			Since:                  row.ServingSince.Time,
			Locales:                row.ServingLocales,
			DefaultAnalysisVersion: row.ServingDefaultAnalysisVersion.Int32,
		},
		State: Serving,
	}
	switch {
	case row.ServingRevision == row.Revision && stored.Serving.indicesCurrent():
	case row.BuildFailedRevision.Valid && row.BuildFailedRevision.Int64 == row.Revision:
		stored.State = BuildFailed
		stored.Failure = &BuildFailure{Error: row.BuildError.String, FailedAt: row.BuildFailedAt.Time}
	default:
		stored.State = Building
	}
	return stored
}

// AnalysisMode is what a save does to the analysis, matching the
// PlatformSearchAnalysisUpdateMode enum of publira.platform.v1.
type AnalysisMode int32

const (
	// AnalysisUnspecified is what a request that says nothing about the
	// analysis carries, and it keeps the saved one.
	AnalysisUnspecified AnalysisMode = 0
	AnalysisUnchanged   AnalysisMode = 1
	// AnalysisReplace saves the definition the request gives.
	AnalysisReplace AnalysisMode = 2
	// AnalysisDefault goes back to the default.
	AnalysisDefault AnalysisMode = 3
)

func (m AnalysisMode) known() bool {
	return m >= AnalysisUnspecified && m <= AnalysisDefault
}

// EffectiveAnalysis is the definition the saved configuration builds its index
// with, as JSON: the saved one, or the default where none is saved. It is
// empty on the SQL engine, which builds none.
func (s Stored) EffectiveAnalysis() string {
	switch {
	case !s.Engine.HasIndex():
		return ""
	case s.Analysis != "":
		return s.Analysis
	default:
		return string(opensearchbackend.DefaultAnalysis())
	}
}

// OwnAnalysisLocales are the languages whose index the saved configuration
// builds from a definition of their own, in the order of IndexLocales. The SQL
// engine builds none.
func (s Stored) OwnAnalysisLocales() []string {
	if !s.Engine.HasIndex() {
		return nil
	}
	var locales []string
	for _, locale := range IndexLocales {
		if _, ok := s.LocaleAnalyses[locale]; ok {
			locales = append(locales, locale)
		}
	}
	return locales
}

// EffectiveLocaleAnalysis is the definition the saved configuration builds the
// index of locale with, as JSON: the language's own, or
// [Stored.EffectiveAnalysis].
func (s Stored) EffectiveLocaleAnalysis(locale string) string {
	if analysis, ok := s.LocaleAnalyses[locale]; ok && s.Engine.HasIndex() {
		return analysis
	}
	return s.EffectiveAnalysis()
}

// analysisFor is the analysis the index of locale is built with, given the
// shared one and those of single languages: empty for the default.
func analysisFor(shared string, own map[string]string, locale string) string {
	if analysis, ok := own[locale]; ok {
		return analysis
	}
	return shared
}

// changedLocales are the languages of IndexLocales whose index the saved
// configuration builds with another analysis than the serving one built it
// with.
func (s Stored) changedLocales() []string {
	var changed []string
	for _, locale := range IndexLocales {
		if analysisFor(s.Analysis, s.LocaleAnalyses, locale) != analysisFor(s.Serving.Analysis, s.Serving.LocaleAnalyses, locale) {
			changed = append(changed, locale)
		}
	}
	return changed
}

// decodeLocaleAnalyses reads a stored locale_analyses column. The column's
// constraint keeps it a JSON object of objects, so a value that does not
// decode is one no write made, and reads as none.
func decodeLocaleAnalyses(stored string) map[string]string {
	if stored == "" {
		return nil
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(stored), &raw); err != nil || len(raw) == 0 {
		return nil
	}
	analyses := make(map[string]string, len(raw))
	for locale, analysis := range raw {
		analyses[locale] = string(analysis)
	}
	return analyses
}

// encodeLocaleAnalyses is the value of the locale_analyses column holding
// analyses, each what [opensearchbackend.ParseAnalysis] answered: one JSON
// object with its keys sorted, so two saves of the same definitions write the
// same text, or empty for none.
func encodeLocaleAnalyses(analyses map[string]string) (string, error) {
	if len(analyses) == 0 {
		return "", nil
	}
	raw := make(map[string]json.RawMessage, len(analyses))
	for locale, analysis := range analyses {
		raw[locale] = json.RawMessage(analysis)
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return "", fmt.Errorf("platformsearch: encode the analyses of single languages: %w", err)
	}
	return string(encoded), nil
}

// Unsaved is what an install that has saved nothing reads as: the SQL engine,
// serving at revision zero.
func Unsaved() Stored {
	sqlEngine := Settings{Engine: EngineSQL}
	return Stored{Settings: sqlEngine, Serving: ServingSettings{Settings: sqlEngine}, State: Serving}
}

func nullable(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}
