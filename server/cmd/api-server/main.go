package main

import (
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/publira/publira/server/internal/apiserver"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const defaultDBURL = "postgres://postgres:password@db:5432/publira?sslmode=disable"

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	dbURL := strings.TrimSpace(os.Getenv("DB_URL"))
	if dbURL == "" {
		dbURL = defaultDBURL
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		logger.Error("failed to open db", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		logger.Error("failed to ping db", "error", err)
		os.Exit(1)
	}
	handler := apiserver.NewHandler(dbmodels.New(db))
	logger.Info("starting api server", "addr", ":8080")
	if err := http.ListenAndServe(":8080", h2c.NewHandler(handler, &http2.Server{})); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
