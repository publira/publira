package platformsearch

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
)

// Engine is the stored name of a search engine.
type Engine string

const (
	// EngineSQL is a substring match in PostgreSQL. It needs nothing beside
	// the database, keeps no index, and is what an install searches with until
	// it saves another engine.
	EngineSQL Engine = "sql"
	// EngineOpenSearch is an OpenSearch node with the analysis-kuromoji and
	// analysis-icu plugins.
	EngineOpenSearch Engine = "opensearch"
)

// Engines lists every engine a save accepts, in the order an error names them.
var Engines = []Engine{EngineSQL, EngineOpenSearch}

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
)

var (
	errURLRequired       = errors.New("a URL is required for this engine")
	errNotHTTPURL        = errors.New("the URL is not an http:// or https:// URL")
	errURLCredentials    = errors.New("the URL carries credentials; give the username and the password on their own instead")
	errSQLTakesNoURL     = errors.New("the sql engine connects to nothing beside the database and takes no URL")
	errSQLTakesNoIndex   = errors.New("the sql engine keeps no index")
	errSQLTakesNoUser    = errors.New("the sql engine connects to nothing beside the database and takes no credentials")
	errCredentialsInHTTP = errors.New("credentials need an https:// URL; over http:// they would cross the network in cleartext")
	errIndexInvalid      = errors.New("the index alias is not a name the engine accepts: lowercase, without spaces, and not starting with -, _, or +")

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
	// Revision is the saved revision it was saved at, zero for the SQL engine
	// of a row that has never served another.
	Revision int64
	// Since is when the search moved onto it, zero at revision zero.
	Since time.Time
}

// BuildFailure is the last build of the saved revision that failed.
type BuildFailure struct {
	Error    string
	FailedAt time.Time
}

// Stored is a saved row as a reader may see it, without either password.
type Stored struct {
	Settings
	HasPassword bool
	Revision    int64
	Serving     ServingSettings
	State       BuildState
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
		HasPassword: strings.TrimSpace(row.PasswordEncrypted.String) != "",
		Revision:    row.Revision,
		Serving: ServingSettings{
			Settings: Settings{
				Engine:   Engine(row.ServingEngine),
				URL:      row.ServingUrl.String,
				Index:    row.ServingIndexAlias.String,
				Username: row.ServingUsername.String,
			},
			Revision: row.ServingRevision,
			Since:    row.ServingSince.Time,
		},
		State: Serving,
	}
	switch {
	case row.ServingRevision == row.Revision:
	case row.BuildFailedRevision.Valid && row.BuildFailedRevision.Int64 == row.Revision:
		stored.State = BuildFailed
		stored.Failure = &BuildFailure{Error: row.BuildError.String, FailedAt: row.BuildFailedAt.Time}
	default:
		stored.State = Building
	}
	return stored
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
