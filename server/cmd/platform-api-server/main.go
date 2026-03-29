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
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

const (
	defaultPlatformServerURL     = ":8002"
	defaultPlatformGrpcServerURL = ":8102"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	db, err := openDB(cfg.DB.URL)
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		os.Exit(1)
	}
	defer db.Close()

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

	handler := platformapi.NewHandler(db, dbmodels.New(db), logger, encryptor, internalsmtp.NewClient())

	// Start Connect server on public port
	logger.Info("starting platform api server (Connect)", "addr", addr)
	connectServer := &http.Server{
		Addr:    addr,
		Handler: h2c.NewHandler(handler, &http2.Server{}),
	}

	// Start gRPC server on internal port
	logger.Info("starting platform api server (gRPC)", "addr", grpcAddr)
	grpcServer := &http.Server{
		Addr:    grpcAddr,
		Handler: h2c.NewHandler(handler, &http2.Server{}),
	}

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
