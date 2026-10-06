package platformsearch

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/secretupdate"
)

var (
	// ErrConflict refuses a save based on a revision the stored row has moved
	// past.
	ErrConflict = errors.New("platform search settings have changed since they were read")

	// ErrAnalysisUnchecked refuses a save whose analysis the engine could not
	// be asked about: one that does not answer, or refuses the credentials.
	ErrAnalysisUnchecked = errors.New("the search engine could not be asked whether it builds an index from the analysis")

	errNegativeRevision = errors.New("expected_revision must not be negative")
)

const (
	auditTargetType = "search_config"
	auditTargetID   = "platform"
)

// Querier reads the saved configuration.
type Querier interface {
	GetPlatformSearchConfig(ctx context.Context) (dbmodels.PlatformSearchConfig, error)
}

// SecretManager encrypts the password a save stores and decrypts the one a
// process connects with.
type SecretManager interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

// Get reads the saved row, reporting false when there is none.
func Get(ctx context.Context, q Querier) (dbmodels.PlatformSearchConfig, bool, error) {
	row, err := q.GetPlatformSearchConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PlatformSearchConfig{}, false, nil
	}
	if err != nil {
		return dbmodels.PlatformSearchConfig{}, false, fmt.Errorf("get platform search config: %w", err)
	}
	return row, true, nil
}

// SaveParams replaces the saved settings. The password is SecretMode applied
// to Password, and the analysis AnalysisMode applied to Analysis.
type SaveParams struct {
	Settings     Settings
	SecretMode   secretupdate.Mode
	Password     string
	AnalysisMode AnalysisMode
	// Analysis is the settings.analysis AnalysisReplace saves, as JSON.
	Analysis string
	// ExpectedRevision is the revision Settings were read at, 0 when none were
	// saved. Nil saves over whatever is stored, for a caller that read nothing.
	ExpectedRevision *int64
}

// Validate refuses p without reading anything.
func (p SaveParams) Validate() error {
	settings := Normalize(p.Settings)
	if err := Validate(settings); err != nil {
		return err
	}
	if _, err := p.analysis(settings, ""); err != nil {
		return err
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision < 0 {
		return &fielderr.Invalid{Field: FieldExpectedRevision, Err: errNegativeRevision}
	}
	return nil
}

// Save writes p in one transaction on db, with its entry filed under actor.
//
// A save that needs no index built moves the search onto it in the same
// write: the SQL engine, or the target the search already answers from with
// other credentials. Any other target is left for the worker to build, and the
// search keeps answering from where it is until that build has completed.
//
// The row is locked first, so the password a save keeps is the one its
// revision was compared against rather than one another session has since
// replaced. A save that changes no stored value writes nothing and files
// nothing.
func Save(
	ctx context.Context,
	db *sql.DB,
	logger *slog.Logger,
	encryptor SecretManager,
	actor auditlog.PlatformActor,
	p SaveParams,
) (dbmodels.PlatformSearchConfig, error) {
	if err := p.Validate(); err != nil {
		return dbmodels.PlatformSearchConfig{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformSearchConfig{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	saved, changed, err := write(ctx, q, encryptor, p)
	if err != nil || !changed {
		return saved, err
	}
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		Action:     "platform_search_settings_updated",
		TargetType: auditTargetType,
		TargetID:   auditTargetID,
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return dbmodels.PlatformSearchConfig{}, fmt.Errorf("audit platform_search_settings_updated: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformSearchConfig{}, fmt.Errorf("commit: %w", err)
	}
	return saved, nil
}

func write(ctx context.Context, q *dbmodels.Queries, encryptor SecretManager, p SaveParams) (dbmodels.PlatformSearchConfig, bool, error) {
	settings := Normalize(p.Settings)
	current, err := q.LockPlatformSearchConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if p.ExpectedRevision != nil && *p.ExpectedRevision != 0 {
			return dbmodels.PlatformSearchConfig{}, false, ErrConflict
		}
		params, err := configParams(settings, p, dbmodels.PlatformSearchConfig{}, encryptor)
		if err != nil {
			return dbmodels.PlatformSearchConfig{}, false, err
		}
		if err := checkAnalysis(ctx, settings, params, dbmodels.PlatformSearchConfig{}, encryptor); err != nil {
			return dbmodels.PlatformSearchConfig{}, false, err
		}
		// Nothing saved is the SQL engine, which is all a first save can
		// share a target with.
		params.Serve = !settings.Engine.HasIndex()
		inserted, err := q.InsertPlatformSearchConfig(ctx, dbmodels.InsertPlatformSearchConfigParams(params))
		// Two first saves both find nothing to lock; the primary key settles
		// which one wins.
		if dberr.IsUniqueViolation(err) {
			return dbmodels.PlatformSearchConfig{}, false, ErrConflict
		}
		if err != nil {
			return dbmodels.PlatformSearchConfig{}, false, fmt.Errorf("insert platform search config: %w", err)
		}
		return inserted, true, nil
	}
	if err != nil {
		return dbmodels.PlatformSearchConfig{}, false, fmt.Errorf("lock platform search config: %w", err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision != current.Revision {
		return dbmodels.PlatformSearchConfig{}, false, ErrConflict
	}
	params, err := configParams(settings, p, current, encryptor)
	if err != nil {
		return dbmodels.PlatformSearchConfig{}, false, err
	}
	if params == storedParams(current) {
		return current, false, nil
	}
	if err := checkAnalysis(ctx, settings, params, current, encryptor); err != nil {
		return dbmodels.PlatformSearchConfig{}, false, err
	}
	// Another analysis is another index, even on the target the search
	// answers from: the one it has was built with the analysis it was.
	serving := FromConfig(current).Serving
	params.Serve = !settings.Engine.HasIndex() || settings.Target() == serving.Target() && params.Analysis.String == serving.Analysis
	updated, err := q.UpdatePlatformSearchConfig(ctx, params)
	if err != nil {
		return dbmodels.PlatformSearchConfig{}, false, fmt.Errorf("update platform search config: %w", err)
	}
	return updated, true, nil
}

// analysis answers the definition the row ends up holding, given the one it
// holds now: what the request gives, the default, or what is saved. The SQL
// engine keeps none.
func (p SaveParams) analysis(settings Settings, current string) (string, error) {
	if !p.AnalysisMode.known() {
		return "", &fielderr.Invalid{Field: FieldAnalysisUpdateMode, Err: fmt.Errorf("%w: %d", errInvalidAnalysisMode, p.AnalysisMode)}
	}
	if !settings.Engine.HasIndex() {
		if p.AnalysisMode == AnalysisReplace {
			return "", &fielderr.Invalid{Field: FieldAnalysis, Err: errSQLTakesNoAnalysis}
		}
		return "", nil
	}
	switch p.AnalysisMode {
	case AnalysisReplace:
		analysis, err := opensearchbackend.ParseAnalysis([]byte(p.Analysis))
		if err != nil {
			return "", &fielderr.Invalid{Field: FieldAnalysis, Err: err}
		}
		return analysis, nil
	case AnalysisDefault:
		return "", nil
	default:
		return current, nil
	}
}

// checkAnalysis has the engine create an empty index from the analysis a save
// writes, and drop it again, whenever the save changes the analysis or takes a
// saved one to another target: a definition the engine refuses is refused
// here, with the engine's reason, rather than by the build that would follow.
// The default taken to a target of its own is left to the connection test,
// which names the plugins it needs.
func checkAnalysis(ctx context.Context, settings Settings, params dbmodels.UpdatePlatformSearchConfigParams, current dbmodels.PlatformSearchConfig, encryptor SecretManager) error {
	analysis := params.Analysis.String
	moved := settings.Target() != FromConfig(current).Target()
	if !settings.Engine.HasIndex() || analysis == current.Analysis.String && (!moved || analysis == "") {
		return nil
	}
	cfg := opensearchbackend.Config{URL: settings.URL, Index: settings.Index, Username: settings.Username, Analysis: analysis}
	if encrypted := params.PasswordEncrypted.String; encrypted != "" {
		if encryptor == nil {
			return ErrSecretManagerUnavailable
		}
		password, err := encryptor.DecryptString(encrypted)
		if err != nil {
			return fmt.Errorf("decrypt the search engine password: %w", err)
		}
		cfg.Password = password
	}
	checkCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	err := opensearchbackend.CheckAnalysis(checkCtx, cfg)
	var refused *opensearchbackend.AnalysisRefusedError
	switch {
	case errors.As(err, &refused):
		return &fielderr.Invalid{Field: FieldAnalysis, Err: refused}
	case err != nil:
		return fmt.Errorf("%w: %w", ErrAnalysisUnchecked, err)
	}
	return nil
}

// Changes reports whether [Save] would write p over the stored row, refusing
// p as Save would. It reads without locking, so a caller that decides on it,
// such as one that tests only an engine it is about to change, can be raced by
// another save; Save itself does not depend on it.
func Changes(ctx context.Context, q Querier, encryptor SecretManager, p SaveParams) (bool, error) {
	if err := p.Validate(); err != nil {
		return false, err
	}
	current, found, err := Get(ctx, q)
	if err != nil || !found {
		return !found, err
	}
	params, err := configParams(Normalize(p.Settings), p, current, encryptor)
	if err != nil {
		return false, err
	}
	return params != storedParams(current), nil
}

// configParams resolves the password and the analysis the row ends up
// holding, and refuses a credential that is only half stated, or whose halves
// no longer belong together. current is the zero row when nothing is saved
// yet. Serve is left for the caller to decide.
func configParams(settings Settings, p SaveParams, current dbmodels.PlatformSearchConfig, encryptor SecretManager) (dbmodels.UpdatePlatformSearchConfigParams, error) {
	analysis, err := p.analysis(settings, current.Analysis.String)
	if err != nil {
		return dbmodels.UpdatePlatformSearchConfigParams{}, err
	}
	encrypted, err := resolvePassword(settings.Username, p.SecretMode, p.Password, current, encryptor)
	if err != nil {
		return dbmodels.UpdatePlatformSearchConfigParams{}, err
	}
	return dbmodels.UpdatePlatformSearchConfigParams{
		Engine:            string(settings.Engine),
		Url:               nullable(settings.URL),
		IndexAlias:        nullable(settings.Index),
		Username:          nullable(settings.Username),
		PasswordEncrypted: nullable(encrypted),
		Analysis:          nullable(analysis),
	}, nil
}

// resolvePassword answers the ciphertext the password column holds after a
// save: the one already there, a newly encrypted one, or nothing.
func resolvePassword(username string, mode secretupdate.Mode, password string, current dbmodels.PlatformSearchConfig, encryptor SecretManager) (string, error) {
	resolved, err := secretupdate.Resolve(mode, password, &fielderr.Invalid{Field: FieldPassword, Err: ErrPasswordRequired})
	if err != nil {
		if errors.Is(err, secretupdate.ErrInvalidMode) {
			return "", &fielderr.Invalid{Field: FieldPasswordUpdateMode, Err: err}
		}
		return "", err
	}
	if username == "" {
		// No username is no credential, so a password stated with none is
		// half of one, and a stored one goes with the username it belonged to.
		if resolved == secretupdate.Replace {
			return "", &fielderr.Invalid{Field: FieldUsername, Err: ErrUsernameRequired}
		}
		return "", nil
	}
	existing := strings.TrimSpace(current.PasswordEncrypted.String)
	switch resolved {
	case secretupdate.Clear:
		return "", &fielderr.Invalid{Field: FieldPassword, Err: ErrPasswordRequired}
	case secretupdate.Unchanged:
		if existing == "" {
			return "", &fielderr.Invalid{Field: FieldPassword, Err: ErrPasswordRequired}
		}
		if username != current.Username.String {
			return "", &fielderr.Invalid{Field: FieldPassword, Err: ErrUsernameChanged}
		}
		return existing, nil
	}
	// The same password sent again keeps the stored ciphertext, so a form
	// that always sends it does not move the revision.
	decrypter, _ := encryptor.(secretupdate.Decrypter)
	if username == current.Username.String && secretupdate.KeepIfSame(resolved, strings.TrimSpace(password), existing, decrypter) == secretupdate.Unchanged {
		return existing, nil
	}
	if encryptor == nil {
		return "", ErrSecretManagerUnavailable
	}
	encrypted, err := encryptor.EncryptString(strings.TrimSpace(password))
	if err != nil {
		return "", fmt.Errorf("encrypt the search engine password: %w", err)
	}
	return encrypted, nil
}

func storedParams(row dbmodels.PlatformSearchConfig) dbmodels.UpdatePlatformSearchConfigParams {
	return dbmodels.UpdatePlatformSearchConfigParams{
		Engine:            row.Engine,
		Url:               row.Url,
		IndexAlias:        row.IndexAlias,
		Username:          row.Username,
		PasswordEncrypted: row.PasswordEncrypted,
		Analysis:          row.Analysis,
	}
}
