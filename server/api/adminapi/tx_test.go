package adminapi

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"

	"github.com/publira/publira/server/internal/rpcmiddleware"
)

func TestBeginTenantTxUsesContextConn(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("db.Conn: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	mock.ExpectBegin()
	mock.ExpectCommit()

	// No pool on the server: a fallback to s.db would fail.
	tx, err := (&adminServer{}).beginTenantTx(rpcmiddleware.WithTenantConn(ctx, conn))
	if err != nil {
		t.Fatalf("beginTenantTx: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	assertExpectations(t, mock)
}

func TestBeginTenantTxFallsBackToSQLMockDB(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectBegin()
	mock.ExpectCommit()

	tx, err := (&adminServer{db: db}).beginTenantTx(context.Background())
	if err != nil {
		t.Fatalf("beginTenantTx: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	assertExpectations(t, mock)
}

func TestBeginTenantTxRequiresTenantConnOutsideSQLMock(t *testing.T) {
	_, err := (&adminServer{}).beginTenantTx(context.Background())
	if err == nil {
		t.Fatal("beginTenantTx succeeded without a tenant-scoped connection")
	}
}
