package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/metrics"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/tracing"
)

// hosted is what one process runs: the server, the worker, or both.
type hosted struct {
	server bool
	worker bool
}

// shared is what a process builds once from the environment and hands to
// every half it hosts, so a process that hosts both holds one of each rather
// than two.
type shared struct {
	logger *slog.Logger
	// revalidate is the one client the process sends Next.js cache tags with;
	// nil when revalidation is off.
	revalidate *revalidate.Client
	// encryptor is declared as the interface, never as *secretcrypto.Manager:
	// a typed nil assigned to an interface is not nil, and it would slip past
	// the guard in emailsettings.DecryptPassword into a nil-receiver method
	// call. A process started without keys has to report an unusable manager,
	// so a handler can retry once an operator restarts it with them.
	encryptor emailsettings.SecretManager
}

// half is what the server or the worker contributes to the process that
// hosts it.
type half struct {
	listeners []listener
	// drain runs once every listener has stopped, before the telemetry is
	// flushed, so the spans of the work it finishes go out with that flush.
	drain []func(context.Context) error
	// close releases the pools and whatever else the half opened. It is the
	// process's last hook, and the cleanup when a half built after it fails.
	close func() error
}

// listener is one http.Server and the name the startup log gives it.
type listener struct {
	name   string
	server *http.Server
}

// startupError is a failure to build what a process hosts, carrying the
// message the log reports it under.
type startupError struct {
	msg string
	err error
}

func (e *startupError) Error() string { return e.msg + ": " + e.err.Error() }
func (e *startupError) Unwrap() error { return e.err }

func failed(msg string, err error) error { return &startupError{msg: msg, err: err} }

// serve builds every half h names on one set of shared dependencies and runs
// their listeners under one httpserver.Serve call, so a single signal stops
// them all on one deadline. Each half keeps its own pools, listeners, and
// readiness checks whether it runs alone or beside the other: hosting both is
// a choice of process boundary, not a merge of the two.
func serve(command string, h hosted) int {
	logger := logging.New(os.Stdout, nil)
	slog.SetDefault(logger)

	// The server's names come first when it is hosted: the first is the
	// process default, and the server is the process the edge points at.
	var serviceNames []string
	if h.server {
		serviceNames = append(serviceNames, serverServiceNames()...)
	}
	if h.worker {
		serviceNames = append(serviceNames, workerServiceNames()...)
	}
	shutdownTracing, err := tracing.Setup(context.Background(), serviceNames...)
	if err != nil {
		// Telemetry is not worth refusing to serve traffic over.
		logger.Error("failed to initialize tracing", "error", err)
	}
	// Metrics describe the process rather than one of the services in it, so
	// they report under the process default alone.
	shutdownMetrics, err := metrics.Setup(context.Background(), serviceNames[0])
	if err != nil {
		logger.Error("failed to initialize metrics", "error", err)
	}

	deps, err := newShared(logger)
	if err != nil {
		logStartupError(logger, err)
		return 1
	}

	var halves []half
	closeHalves := func() error {
		var errs []error
		for _, built := range halves {
			errs = append(errs, built.close())
		}
		return errors.Join(errs...)
	}
	// Either half failing to build stops the process, as it does when the
	// half runs alone, and takes the half built before it down too.
	host := func(built half, err error) bool {
		if err != nil {
			logStartupError(logger, err)
			_ = closeHalves()
			return false
		}
		halves = append(halves, built)
		return true
	}
	if h.server && !host(buildServer(deps)) {
		return 1
	}
	if h.worker && !host(buildWorker(deps)) {
		return 1
	}

	var servers []*http.Server
	var hooks []func(context.Context) error
	for _, built := range halves {
		for _, l := range built.listeners {
			logger.Info("starting "+l.name, "addr", l.server.Addr)
			servers = append(servers, l.server)
		}
		hooks = append(hooks, built.drain...)
	}
	hooks = append(hooks, shutdownTracing, shutdownMetrics, func(context.Context) error {
		return closeHalves()
	})

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := httpserver.Serve(ctx, logger, servers, hooks...); err != nil {
		logger.Error(command+" failed", "error", err)
		return 1
	}
	return 0
}

func newShared(logger *slog.Logger) (shared, error) {
	cfg, err := config.New()
	if err != nil {
		return shared{}, failed("failed to load config", err)
	}

	revalidateClient, err := newRevalidateClient(logger)
	if err != nil {
		return shared{}, failed("failed to initialize next revalidate", err)
	}

	deps := shared{logger: logger, revalidate: revalidateClient}
	if len(cfg.Encryption.Keys) > 0 {
		manager, err := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if err != nil {
			return shared{}, failed("failed to initialize secret encryption manager", err)
		}
		deps.encryptor = manager
	}
	return deps, nil
}

func logStartupError(logger *slog.Logger, err error) {
	var startup *startupError
	if errors.As(err, &startup) {
		logger.Error(startup.msg, "error", startup.err)
		return
	}
	logger.Error("failed to start", "error", err)
}
