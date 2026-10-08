package platformapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/testutil"
)

// serviceContext is the context a handler sees behind the service token.
func serviceContext(t *testing.T) context.Context {
	t.Helper()

	return context.WithValue(t.Context(), platformActorContextKey{}, platformActor{Service: true})
}

// An RPC put on the allowlist by mistake still fails closed at the checks that
// would otherwise have needed an operator.
func TestServicePrincipalFailsClosedWhereAnOperatorIsNeeded(t *testing.T) {
	s := &platformServer{tokens: testutil.TokenManager()}

	checks := map[string]func(context.Context) error{
		"a platform write role": func(ctx context.Context) error {
			_, err := s.requirePlatformWriteActor(ctx, nil)
			return err
		},
		"an audit actor": func(ctx context.Context) error {
			_, err := s.auditActor(ctx)
			return err
		},
		"the owner of the notifications": func(ctx context.Context) error {
			_, err := s.requirePlatformNotificationActor(ctx)
			return err
		},
	}
	for name, check := range checks {
		t.Run(name, func(t *testing.T) {
			if code := connect.CodeOf(check(serviceContext(t))); code != connect.CodePermissionDenied {
				t.Fatalf("code = %v, want %v", code, connect.CodePermissionDenied)
			}
		})
	}
}
