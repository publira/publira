package publicapi

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// expectPublishedWebPushPublicKey answers the storefront's read of the VAPID
// public key: the key when publicKey is set, and no row, which is what an
// installation with no subject saved answers, when it is empty.
func expectPublishedWebPushPublicKey(mock sqlmock.Sqlmock, publicKey string) {
	expectation := mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedWebPushPublicKey))
	if publicKey == "" {
		expectation.WillReturnError(sql.ErrNoRows)
		return
	}
	expectation.WillReturnRows(sqlmock.NewRows([]string{"vapid_public_key"}).AddRow(publicKey))
}

// expectPushDeviceCharge answers the reads the reader flood control makes to
// charge a registration or a removal: no policy saved and no tenant override,
// so the built-in limits stand.
func expectPushDeviceCharge(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	expectNoSavedPlatformPolicy(mock)
	expectNoTenantCommunityLimitOverrides(mock, tenantID)
}

// expectPushDeviceAccountLocked answers the transaction a registration opens
// and the lock on the reader's account it takes before writing.
func expectPushDeviceAccountLocked(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, now time.Time) {
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByIDForUpdate)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at", "credentials_version", "birth_date", "icon_image_id", "icon_preset_id", "last_locale", "password_proven_at"}).
			AddRow(userID, testPublicUserPublicID, "member@example.com", "", "Member User", now, "active", uuid.NullUUID{UUID: tenantID, Valid: true}, now, int32(1), nil, nil, nil, nil, nil))
}

// expectPushDevicesTrimmed answers the removal of what the reader holds past
// the cap, keeping token, and the commit that follows it.
func expectPushDevicesTrimmed(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, token string) {
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteUserPushDevicesBeyondNewest)).
		WithArgs(tenantID, userID, token, int32(maxPushDevicesPerAccount-1)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
}

func TestRegisterPushDeviceStoresTheTokenForTheSignedInReader(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)
	expectLegalPagesAgreed(mock, tenantID, userID)
	expectPushDeviceCharge(mock, tenantID)

	expectPushDeviceAccountLocked(mock, tenantID, userID, now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertUserPushDevice)).
		WithArgs(tenantID, userID, "device-token", "android", "registration_token", sql.NullString{}, sql.NullString{}, sql.NullString{}).
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_id", "user_id", "token", "platform", "created_at", "updated_at", "endpoint", "p256dh", "auth", "token_type",
		}).AddRow(tenantID, userID, "device-token", "android", now, now, nil, nil, nil, "registration_token"))
	expectPushDevicesTrimmed(mock, tenantID, userID, "device-token")

	resp, err := client.RegisterPushDevice(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.RegisterPushDeviceRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:    "  device-token  ",
		Platform: publirav1.PushPlatform_PUSH_PLATFORM_ANDROID,
	})
	if err != nil {
		t.Fatalf("RegisterPushDevice: %v", err)
	}
	if !resp.Registered {
		t.Fatal("registered = false, want true")
	}

	assertPublicExpectations(t, mock)
}

func TestRegisterPushDeviceStoresWhatTheTokenIs(t *testing.T) {
	tests := []struct {
		name      string
		tokenType publirav1.PushTokenType
		want      string
	}{
		{name: "registration token", tokenType: publirav1.PushTokenType_PUSH_TOKEN_TYPE_REGISTRATION_TOKEN, want: "registration_token"},
		{name: "installation id", tokenType: publirav1.PushTokenType_PUSH_TOKEN_TYPE_INSTALLATION_ID, want: "installation_id"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock := newNotificationClient(t, tenantID, userID, now)
			expectLegalPagesAgreed(mock, tenantID, userID)
			expectPushDeviceCharge(mock, tenantID)

			expectPushDeviceAccountLocked(mock, tenantID, userID, now)
			mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertUserPushDevice)).
				WithArgs(tenantID, userID, "device-registration", "ios", tt.want, sql.NullString{}, sql.NullString{}, sql.NullString{}).
				WillReturnRows(sqlmock.NewRows([]string{
					"tenant_id", "user_id", "token", "platform", "created_at", "updated_at", "endpoint", "p256dh", "auth", "token_type",
				}).AddRow(tenantID, userID, "device-registration", "ios", now, now, nil, nil, nil, tt.want))
			expectPushDevicesTrimmed(mock, tenantID, userID, "device-registration")

			_, err := client.RegisterPushDevice(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.RegisterPushDeviceRequest{
				Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:     "device-registration",
				Platform:  publirav1.PushPlatform_PUSH_PLATFORM_IOS,
				TokenType: tt.tokenType,
			})
			if err != nil {
				t.Fatalf("RegisterPushDevice: %v", err)
			}

			assertPublicExpectations(t, mock)
		})
	}
}

func TestRegisterWebPushDeviceRequiresVAPIDConfiguration(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	client, mock := newNotificationClient(t, tenantID, userID, time.Now().UTC())
	expectLegalPagesAgreed(mock, tenantID, userID)
	expectPushDeviceCharge(mock, tenantID)
	expectPublishedWebPushPublicKey(mock, "")

	_, err := client.RegisterPushDevice(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.RegisterPushDeviceRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Platform: publirav1.PushPlatform_PUSH_PLATFORM_WEB,
		Endpoint: "https://push.example.test/subscription",
		P256Dh:   "p256dh",
		Auth:     "auth",
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("RegisterPushDevice code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestRegisterWebPushDeviceStoresSubscription(t *testing.T) {
	_, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("GenerateVAPIDKeys: %v", err)
	}
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)
	expectLegalPagesAgreed(mock, tenantID, userID)
	expectPushDeviceCharge(mock, tenantID)
	expectPublishedWebPushPublicKey(mock, publicKey)

	expectPushDeviceAccountLocked(mock, tenantID, userID, now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertUserPushDevice)).
		WithArgs(tenantID, userID, "https://push.example.test/subscription", "web", "registration_token", sql.NullString{String: "https://push.example.test/subscription", Valid: true}, sql.NullString{String: "p256dh", Valid: true}, sql.NullString{String: "auth", Valid: true}).
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_id", "user_id", "token", "platform", "created_at", "updated_at", "endpoint", "p256dh", "auth", "token_type",
		}).AddRow(tenantID, userID, "https://push.example.test/subscription", "web", now, now, "https://push.example.test/subscription", "p256dh", "auth", "registration_token"))
	expectPushDevicesTrimmed(mock, tenantID, userID, "https://push.example.test/subscription")

	_, err = client.RegisterPushDevice(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.RegisterPushDeviceRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Platform: publirav1.PushPlatform_PUSH_PLATFORM_WEB,
		Endpoint: "https://push.example.test/subscription",
		P256Dh:   "p256dh",
		Auth:     "auth",
	})
	if err != nil {
		t.Fatalf("RegisterPushDevice: %v", err)
	}
	assertPublicExpectations(t, mock)
}

func TestRegisterPushDeviceRejectsAnUnusableRequest(t *testing.T) {
	tests := []struct {
		name      string
		token     string
		platform  publirav1.PushPlatform
		tokenType publirav1.PushTokenType
		endpoint  string
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
		{
			name:      "token type no release defines",
			token:     "device-token",
			platform:  publirav1.PushPlatform_PUSH_PLATFORM_ANDROID,
			tokenType: publirav1.PushTokenType(99),
		},
		{
			name:      "installation id for a web push subscription",
			platform:  publirav1.PushPlatform_PUSH_PLATFORM_WEB,
			tokenType: publirav1.PushTokenType_PUSH_TOKEN_TYPE_INSTALLATION_ID,
			endpoint:  "https://push.example.test/subscription",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock := newNotificationClient(t, tenantID, userID, now)
			expectLegalPagesAgreed(mock, tenantID, userID)
			expectPushDeviceCharge(mock, tenantID)

			_, err := client.RegisterPushDevice(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.RegisterPushDeviceRequest{
				Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:     tt.token,
				Platform:  tt.platform,
				TokenType: tt.tokenType,
				Endpoint:  tt.endpoint,
			})
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

	client := publirav1connect.NewNotificationServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.RegisterPushDevice(context.Background(), &publirav1.RegisterPushDeviceRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:    "device-token",
		Platform: publirav1.PushPlatform_PUSH_PLATFORM_ANDROID,
	})
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
			expectPushDeviceCharge(mock, tenantID)

			mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteUserPushDeviceForUser)).
				WithArgs(tenantID, userID, "device-token").
				WillReturnResult(sqlmock.NewResult(0, tt.removed))

			resp, err := client.UnregisterPushDevice(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.UnregisterPushDeviceRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:  "device-token",
			})
			if err != nil {
				t.Fatalf("UnregisterPushDevice: %v", err)
			}
			if resp.Unregistered != tt.want {
				t.Fatalf("unregistered = %t, want %t", resp.Unregistered, tt.want)
			}

			assertPublicExpectations(t, mock)
		})
	}
}

func TestUnregisterPushDeviceUsesWebPushEndpoint(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)
	endpoint := "https://push.example.test/subscription"
	expectPushDeviceCharge(mock, tenantID)
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteUserPushDeviceForUser)).
		WithArgs(tenantID, userID, endpoint).
		WillReturnResult(sqlmock.NewResult(0, 1))

	resp, err := client.UnregisterPushDevice(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.UnregisterPushDeviceRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Endpoint: endpoint,
	})
	if err != nil {
		t.Fatalf("UnregisterPushDevice: %v", err)
	}
	if !resp.Unregistered {
		t.Fatal("unregistered = false, want true")
	}
	assertPublicExpectations(t, mock)
}
