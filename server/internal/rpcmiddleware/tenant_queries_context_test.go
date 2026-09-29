package rpcmiddleware_test

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"

	"github.com/publira/publira/server/internal/rpcmiddleware"
)

func TestTenantConnRoundTrip(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("db.Conn: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	ctx := rpcmiddleware.WithTenantConn(context.Background(), conn)
	got, ok := rpcmiddleware.TenantConnFromContext(ctx)
	if !ok {
		t.Fatal("TenantConnFromContext returned false")
	}
	if got != conn {
		t.Fatal("TenantConnFromContext returned a different connection")
	}
}

func TestTenantConnFromContextMissing(t *testing.T) {
	if _, ok := rpcmiddleware.TenantConnFromContext(context.Background()); ok {
		t.Fatal("TenantConnFromContext returned true on an empty context")
	}
}
