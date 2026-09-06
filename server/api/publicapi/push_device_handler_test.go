package publicapi

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

const (
	upsertUserPushDeviceQuery        = "-- name: UpsertUserPushDevice :one\n"
	deleteUserPushDeviceForUserQuery = "-- name: DeleteUserPushDeviceForUser :execrows\n"
)

func TestRegisterPushDeviceStoresTheTokenForTheSignedInReader(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(upsertUserPushDeviceQuery)).
		WithArgs(tenantID, userID, "device-token", "android").
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_id", "user_id", "token", "platform", "created_at", "updated_at",
		}).AddRow(tenantID, userID, "device-token", "android", now, now))

	resp, err := client.RegisterPushDevice(context.Background(), newAuthedPublicRequest(&publirav1.RegisterPushDeviceRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:    "  device-token  ",
		Platform: publirav1.PushPlatform_PUSH_PLATFORM_ANDROID,
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("RegisterPushDevice: %v", err)
	}
	if !resp.Msg.Registered {
		t.Fatal("registered = false, want true")
	}

	assertPublicExpectations(t, mock)
}

func TestRegisterPushDeviceRejectsAnUnusableRequest(t *testing.T) {
	tests := []struct {
		name     string
		token    string
		platform publirav1.PushPlatform
	}{
		{
			name:     "empty token",
			token:    "   ",
			platform: publirav1.PushPlatform_PUSH_PLATFORM_ANDROID,
		},
		{
			name:     "token over the length bound",
			token:    strings.Repeat("t", maxPushDeviceTokenBytes+1),
			platform: publirav1.PushPlatform_PUSH_PLATFORM_IOS,
		},
		{
			name:     "unspecified platform",
			token:    "device-token",
			platform: publirav1.PushPlatform_PUSH_PLATFORM_UNSPECIFIED,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock := newNotificationClient(t, tenantID, userID, now)

			_, err := client.RegisterPushDevice(context.Background(), newAuthedPublicRequest(&publirav1.RegisterPushDeviceRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:    tt.token,
				Platform: tt.platform,
			}, tenantID.String()))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("RegisterPushDevice code = %v, want invalid_argument", connect.CodeOf(err))
			}

			assertPublicExpectations(t, mock)
		})
	}
}

func TestRegisterPushDeviceRequiresASession(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewNotificationServiceClient(testServer.Client(), testServer.URL)
	_, err := client.RegisterPushDevice(context.Background(), connect.NewRequest(&publirav1.RegisterPushDeviceRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:    "device-token",
		Platform: publirav1.PushPlatform_PUSH_PLATFORM_ANDROID,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("RegisterPushDevice code = %v, want unauthenticated", connect.CodeOf(err))
	}
}

func TestUnregisterPushDeviceReportsWhetherARowWasRemoved(t *testing.T) {
	tests := []struct {
		name    string
		removed int64
		want    bool
	}{
		{name: "the reader held the token", removed: 1, want: true},
		{name: "nothing was registered", removed: 0, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock := newNotificationClient(t, tenantID, userID, now)

			mock.ExpectExec(regexp.QuoteMeta(deleteUserPushDeviceForUserQuery)).
				WithArgs(tenantID, userID, "device-token").
				WillReturnResult(sqlmock.NewResult(0, tt.removed))

			resp, err := client.UnregisterPushDevice(context.Background(), newAuthedPublicRequest(&publirav1.UnregisterPushDeviceRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:  "device-token",
			}, tenantID.String()))
			if err != nil {
				t.Fatalf("UnregisterPushDevice: %v", err)
			}
			if resp.Msg.Unregistered != tt.want {
				t.Fatalf("unregistered = %t, want %t", resp.Msg.Unregistered, tt.want)
			}

			assertPublicExpectations(t, mock)
		})
	}
}
