package main

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

const (
	defaultPlatformServerURL     = ":8002"
	defaultPlatformGrpcServerURL = ":8102"
	defaultPlatformDBURL         = "postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	db, err := openDB(resolvePlatformDBURL())
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		os.Exit(1)
	}
	defer db.Close() //nolint:errcheck

	var encryptor *secretcrypto.Manager
	if len(cfg.Encryption.Keys) > 0 {
		encryptor, err = secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if err != nil {
			logger.Error("failed to initialize secret encryption manager", "error", err)
			os.Exit(1)
		}
	}

	addr := strings.TrimSpace(os.Getenv("PLATFORM_API_ADDR"))
	if addr == "" {
		addr = defaultPlatformServerURL
	}

	grpcAddr := strings.TrimSpace(os.Getenv("PLATFORM_API_GRPC_ADDR"))
	if grpcAddr == "" {
		grpcAddr = defaultPlatformGrpcServerURL
	}

	handler := platformapi.NewHandler(db, dbmodels.New(db), logger, encryptor, internalsmtp.NewClient(), emailrenderer.NewClient(resolveEmailRendererURL()))

	// Start Connect server on public port
	logger.Info("starting platform api server (Connect)", "addr", addr)
	connectServer := httpserver.New(addr, handler)

	// Start gRPC server on internal port
	logger.Info("starting platform api server (gRPC)", "addr", grpcAddr)
	grpcServer := httpserver.New(grpcAddr, handler)

	// Run servers concurrently
	var wg sync.WaitGroup
	var connectErr, grpcErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		if err := connectServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			connectErr = err
			logger.Error("connect server failed", "error", err)
		}
	}()

	go func() {
		defer wg.Done()
		if err := grpcServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			grpcErr = err
			logger.Error("grpc server failed", "error", err)
		}
	}()

	wg.Wait()

	if connectErr != nil {
		os.Exit(1)
	}
	if grpcErr != nil {
		os.Exit(1)
	}
}

func openDB(url string) (*sql.DB, error) {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func resolvePlatformDBURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_PLATFORM_DB_URL")); url != "" {
		return url
	}
	return defaultPlatformDBURL
}

func resolveEmailRendererURL() string {
	if url := strings.TrimSpace(os.Getenv("EMAIL_RENDERER_URL")); url != "" {
		return url
	}
	return emailrenderer.DefaultURL
}
