package platformapi

import (
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

// newDBIntegrationTestServer starts an httptest server backed by a real PostgreSQL
// (Testcontainers). Resets the shared DB, seeds a platform operator, and returns
// the server URL plus operator metadata for auth tokens.
func newDBIntegrationTestServer(t *testing.T) (*httptest.Server, testutil.PlatformOperator) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	db := pg.OpenPlatformDB(t)

	server := httptest.NewServer(NewHandler(db, dbmodels.New(db), slog.Default(), nil, nil))
	t.Cleanup(server.Close)
	return server, operator
}

func issueDBIntegrationToken(operator testutil.PlatformOperator) string {
	token, _, err := auth.MustTokenManagerFromEnv().Issue(
		operator.PublicID,
		auth.AudiencePlatform,
		"",
		operator.Role,
		operator.CredentialsVersion,
		time.Now(),
	)
	if err != nil {
		panic(err)
	}
	return token
}

func newDBAuthedRequest[T any](operator testutil.PlatformOperator, msg T) *connect.Request[T] {
	req := connect.NewRequest(&msg)
	req.Header().Set("Authorization", "Bearer "+issueDBIntegrationToken(operator))
	return req
}
