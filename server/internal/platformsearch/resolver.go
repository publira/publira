package platformsearch

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// RefreshInterval is how long a Resolver keeps answering from one read of the
// row, and so how long a change takes to reach the processes that search.
const RefreshInterval = 30 * time.Second

// connectTimeout bounds how long opening an engine waits for it to answer.
const connectTimeout = 30 * time.Second

// Decrypter decrypts a stored password.
type Decrypter interface {
	DecryptString(value string) (string, error)
}

// ResolverConfig is what a Resolver reads with.
type ResolverConfig struct {
	Queries Querier
	// Secrets decrypts a stored password. Nil is a process started without
	// encryption keys, which can still use an engine reached without one.
	Secrets Decrypter
	// Interval overrides RefreshInterval. Zero keeps the default; a negative
	// value rereads the row on every call.
	Interval time.Duration
	Logger   *slog.Logger
}

// Resolver answers the engines the saved row names, opening each one once and
// keeping it for as long as the row names it.
type Resolver struct {
	queries  Querier
	secrets  Decrypter
	interval time.Duration
	now      func() time.Time
	logger   *slog.Logger

	mu sync.Mutex
	// read says the row has been read at least once, successfully.
	read       bool
	row        dbmodels.PlatformSearchConfig
	found      bool
	nextReadAt time.Time
	open       map[opensearchbackend.Config]*opensearchbackend.Backend
}

// NewResolver returns a Resolver over cfg.
func NewResolver(cfg ResolverConfig) *Resolver {
	interval := cfg.Interval
	switch {
	case interval == 0:
		interval = RefreshInterval
	case interval < 0:
		interval = 0
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &Resolver{
		queries:  cfg.Queries,
		secrets:  cfg.Secrets,
		interval: interval,
		now:      time.Now,
		logger:   logger,
		open:     map[opensearchbackend.Config]*opensearchbackend.Backend{},
	}
}

// Serving answers the backend the search answers from, nil on the SQL engine.
func (r *Resolver) Serving(ctx context.Context) (*opensearchbackend.Backend, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.refresh(ctx); err != nil {
		return nil, err
	}
	stored := r.stored()
	if !stored.Serving.Engine.HasIndex() {
		r.prune()
		return nil, nil
	}
	cfg, err := r.config(stored.Serving.Settings, r.row.ServingPasswordEncrypted.String)
	if err != nil {
		return nil, err
	}
	backend, err := r.backend(ctx, cfg, false)
	r.prune(cfg)
	return backend, err
}

// Targets answers every backend a catalog write goes to: the one the search
// answers from, and the one being built while a build is due. A target whose
// build failed is left out, so an engine that refused the index does not hold
// up every write until an operator fixes it; the build that follows the fix
// writes the whole catalog there anyway.
func (r *Resolver) Targets(ctx context.Context) ([]*opensearchbackend.Backend, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.refresh(ctx); err != nil {
		return nil, err
	}
	stored := r.stored()
	var configs []opensearchbackend.Config
	var backends []*opensearchbackend.Backend
	add := func(settings Settings, encrypted string, building bool) error {
		cfg, err := r.config(settings, encrypted)
		if err != nil {
			return err
		}
		backend, err := r.backend(ctx, cfg, building)
		if err != nil {
			return err
		}
		configs, backends = append(configs, cfg), append(backends, backend)
		return nil
	}
	if stored.Serving.Engine.HasIndex() {
		if err := add(stored.Serving.Settings, r.row.ServingPasswordEncrypted.String, false); err != nil {
			return nil, err
		}
	}
	if stored.State == Building && stored.Engine.HasIndex() && stored.Target() != stored.Serving.Target() {
		if err := add(stored.Settings, r.row.PasswordEncrypted.String, true); err != nil {
			return nil, err
		}
	}
	r.prune(configs...)
	return backends, nil
}

// refresh rereads the row once the interval has passed. A failed reread keeps
// the row read last; only a process that has never read one fails.
func (r *Resolver) refresh(ctx context.Context) error {
	now := r.now()
	if r.read && now.Before(r.nextReadAt) {
		return nil
	}
	if r.queries == nil {
		return errors.New("platformsearch: queries is nil")
	}
	row, found, err := Get(ctx, r.queries)
	switch {
	case err != nil && !r.read:
		return err
	case err != nil:
		r.logger.WarnContext(ctx, "serving the last platform search configuration read", "error", err)
	default:
		if r.read && (r.found != found || r.row.Revision != row.Revision || r.row.ServingRevision != row.ServingRevision) {
			r.logger.InfoContext(ctx, "platform search configuration loaded", "revision", row.Revision, "serving_revision", row.ServingRevision)
		}
		r.read, r.row, r.found = true, row, found
	}
	r.nextReadAt = now.Add(r.interval)
	return nil
}

func (r *Resolver) stored() Stored {
	if !r.found {
		return Unsaved()
	}
	return FromConfig(r.row)
}

// config is the client configuration of settings, with encrypted decrypted.
func (r *Resolver) config(settings Settings, encrypted string) (opensearchbackend.Config, error) {
	cfg := opensearchbackend.Config{URL: settings.URL, Index: settings.Index, Username: settings.Username}
	if strings.TrimSpace(encrypted) == "" {
		return cfg, nil
	}
	if r.secrets == nil {
		return opensearchbackend.Config{}, ErrSecretManagerUnavailable
	}
	password, err := r.secrets.DecryptString(strings.TrimSpace(encrypted))
	if err != nil {
		return opensearchbackend.Config{}, fmt.Errorf("decrypt the search engine password: %w", err)
	}
	cfg.Password = password
	return cfg, nil
}

// backend opens cfg's engine once and answers the same backend after that.
//
// The engine the search answers from has its index already, so it is opened
// without a request: one that has stopped answering fails each search on the
// search's own timeout, rather than holding every caller of the resolver for
// a connection attempt. One being built may not have it yet, and a write to an
// alias nothing has created would create an index of that name with whatever
// mapping the document implies, so it is connected to and its index ensured
// first. A failed open is not kept, so the next call tries again.
func (r *Resolver) backend(ctx context.Context, cfg opensearchbackend.Config, building bool) (*opensearchbackend.Backend, error) {
	if backend, ok := r.open[cfg]; ok {
		return backend, nil
	}
	var backend *opensearchbackend.Backend
	var err error
	if building {
		connectCtx, cancel := context.WithTimeout(ctx, connectTimeout)
		backend, err = opensearchbackend.New(connectCtx, cfg)
		cancel()
	} else {
		backend, err = opensearchbackend.Open(cfg)
	}
	if err != nil {
		return nil, err
	}
	r.open[cfg] = backend
	return backend, nil
}

// prune drops every open backend but keep's, which is what the row names now.
func (r *Resolver) prune(keep ...opensearchbackend.Config) {
	for cfg := range r.open {
		kept := false
		for _, k := range keep {
			kept = kept || cfg == k
		}
		if !kept {
			delete(r.open, cfg)
		}
	}
}
