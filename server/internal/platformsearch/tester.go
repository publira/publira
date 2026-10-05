package platformsearch

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/secretupdate"
)

// The reasons a connection test fails for. They name what went wrong and never
// carry the engine's own message.
const (
	ReasonUnreachable   = "SEARCH_TEST_UNREACHABLE"
	ReasonUnauthorized  = "SEARCH_TEST_UNAUTHORIZED"
	ReasonNotAnEngine   = "SEARCH_TEST_NOT_A_SEARCH_ENGINE"
	ReasonWrongProduct  = "SEARCH_TEST_WRONG_PRODUCT"
	ReasonMissingPlugin = "SEARCH_TEST_PLUGIN_MISSING"
)

// ErrNotSaved is what a test of the saved settings finds when there are none.
var ErrNotSaved = errors.New("platform search settings are not saved")

var errSQLHasNothingToTest = errors.New("the sql engine connects to nothing beside the database, so there is nothing to test")

// Result is what a connection test found.
type Result struct {
	// Reason is empty on success.
	Reason          string
	Product         string
	Version         string
	KuromojiPresent bool
	ICUPresent      bool
}

// Succeeded reports whether the engine answered as the one the settings name,
// with both plugins.
func (r Result) Succeeded() bool {
	return r.Reason == ""
}

// Prober asks an engine what it is. [opensearchbackend.ProbeEngine] is the one
// every process uses.
type Prober func(ctx context.Context, cfg opensearchbackend.Config) (opensearchbackend.Probe, error)

// TestParams tests settings that may not be saved. The password is SecretMode
// applied to Password, over the saved one.
type TestParams struct {
	Settings   Settings
	SecretMode secretupdate.Mode
	Password   string
}

// Tester runs the connection test and files an entry for every run.
type Tester struct {
	Secrets  Decrypter
	Probe    Prober
	Recorder auditlog.Recorder
}

// Test runs the connection test against p's settings.
func (t Tester) Test(ctx context.Context, q Querier, actor auditlog.PlatformActor, p TestParams) (Result, error) {
	settings := Normalize(p.Settings)
	if !settings.Engine.HasIndex() && settings.Engine.Known() {
		return Result{}, &fielderr.Invalid{Field: FieldEngine, Err: errSQLHasNothingToTest}
	}
	if err := Validate(settings); err != nil {
		return Result{}, err
	}
	saved, _, err := Get(ctx, q)
	if err != nil {
		return Result{}, err
	}
	password, err := t.password(settings.Username, p.SecretMode, p.Password, saved.Username.String, saved.PasswordEncrypted.String)
	if err != nil {
		return Result{}, err
	}
	return t.run(ctx, actor, settings, password), nil
}

// TestSaved runs the connection test against the saved settings.
func (t Tester) TestSaved(ctx context.Context, q Querier, actor auditlog.PlatformActor) (Result, error) {
	saved, found, err := Get(ctx, q)
	if err != nil {
		return Result{}, err
	}
	if !found {
		return Result{}, ErrNotSaved
	}
	stored := FromConfig(saved)
	if !stored.Engine.HasIndex() {
		return Result{}, &fielderr.Invalid{Field: FieldEngine, Err: errSQLHasNothingToTest}
	}
	password, err := t.password(stored.Username, secretupdate.Unchanged, "", saved.Username.String, saved.PasswordEncrypted.String)
	if err != nil {
		return Result{}, err
	}
	return t.run(ctx, actor, stored.Settings, password), nil
}

// password is the password a test sends: the one stated, the saved one, or
// none, refused where it is half of a credential as a save would refuse it.
func (t Tester) password(username string, mode secretupdate.Mode, password, savedUsername, savedEncrypted string) (string, error) {
	resolved, err := secretupdate.Resolve(mode, password, &fielderr.Invalid{Field: FieldPassword, Err: ErrPasswordRequired})
	if err != nil {
		if errors.Is(err, secretupdate.ErrInvalidMode) {
			return "", &fielderr.Invalid{Field: FieldPasswordUpdateMode, Err: err}
		}
		return "", err
	}
	if username == "" {
		if resolved == secretupdate.Replace {
			return "", &fielderr.Invalid{Field: FieldUsername, Err: ErrUsernameRequired}
		}
		return "", nil
	}
	switch resolved {
	case secretupdate.Replace:
		return strings.TrimSpace(password), nil
	case secretupdate.Clear:
		return "", &fielderr.Invalid{Field: FieldPassword, Err: ErrPasswordRequired}
	}
	savedEncrypted = strings.TrimSpace(savedEncrypted)
	if savedEncrypted == "" {
		return "", &fielderr.Invalid{Field: FieldPassword, Err: ErrPasswordRequired}
	}
	if username != savedUsername {
		return "", &fielderr.Invalid{Field: FieldPassword, Err: ErrUsernameChanged}
	}
	if t.Secrets == nil {
		return "", ErrSecretManagerUnavailable
	}
	decrypted, err := t.Secrets.DecryptString(savedEncrypted)
	if err != nil {
		return "", fmt.Errorf("decrypt the search engine password: %w", err)
	}
	return decrypted, nil
}

func (t Tester) run(ctx context.Context, actor auditlog.PlatformActor, settings Settings, password string) Result {
	probe := t.Probe
	if probe == nil {
		probe = opensearchbackend.ProbeEngine
	}
	connectCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	found, err := probe(connectCtx, opensearchbackend.Config{URL: settings.URL, Username: settings.Username, Password: password})
	cancel()
	result := evaluate(settings.Engine, found, err)

	entry := auditlog.PlatformEntry{
		Action:     "platform_search_connection_tested",
		TargetType: auditTargetType,
		TargetID:   auditTargetID,
		Outcome:    auditlog.OutcomeSuccess,
	}
	if !result.Succeeded() {
		entry.Outcome, entry.Reason = auditlog.OutcomeFailure, result.Reason
	}
	t.Recorder.RecordPlatform(ctx, actor.Entry(entry))
	return result
}

// products names the product each engine has to report itself as.
var products = map[Engine]string{
	EngineOpenSearch:    opensearchbackend.ProductOpenSearch,
	EngineElasticsearch: opensearchbackend.ProductElasticsearch,
}

func evaluate(engine Engine, probe opensearchbackend.Probe, err error) Result {
	switch {
	case errors.Is(err, opensearchbackend.ErrUnauthorized):
		return Result{Reason: ReasonUnauthorized}
	case errors.Is(err, opensearchbackend.ErrUnexpectedAnswer):
		return Result{Reason: ReasonNotAnEngine}
	case err != nil:
		return Result{Reason: ReasonUnreachable}
	}
	result := Result{
		Product:         probe.Product,
		Version:         probe.Version,
		KuromojiPresent: probe.HasPlugin(opensearchbackend.PluginAnalysisKuromoji),
		ICUPresent:      probe.HasPlugin(opensearchbackend.PluginAnalysisICU),
	}
	switch {
	case probe.Product != products[engine]:
		result.Reason = ReasonWrongProduct
	case !result.KuromojiPresent || !result.ICUPresent:
		result.Reason = ReasonMissingPlugin
	}
	return result
}
