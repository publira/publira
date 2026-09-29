package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

// An email change is confirmed by exactly one of the password and a fresh
// sign-in. sqlmock refuses any statement past the session it was told to
// expect, so a request carrying both or neither must be refused before it reads
// anything else.
func TestAuthRequestEmailChangeTakesExactlyOneConfirmation(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*publirav1.RequestEmailChangeRequest)
	}{
		{name: "neither", edit: func(*publirav1.RequestEmailChangeRequest) {}},
		{name: "both", edit: func(req *publirav1.RequestEmailChangeRequest) {
			req.CurrentPassword = "the-password"
			req.Provider = publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE
			req.IdToken = "id-token"
			req.Nonce = "nonce"
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC()
			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectAuthSession(mock, tenantID, userID, now)

			req := &publirav1.RequestEmailChangeRequest{
				Tenant:       &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				CurrentEmail: "member@example.com",
				NewEmail:     "moved@example.com",
			}
			tc.edit(req)
			client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
			_, err := client.RequestEmailChange(context.Background(), newAuthedPublicRequest(req, tenantID.String()))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}

			assertPublicExpectations(t, mock)
		})
	}
}
