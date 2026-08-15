package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/tenanttz"
)

func newPlatformSettingsActorContext() context.Context {
	return context.WithValue(context.Background(), platformActorContextKey{}, platformActor{
		UserID: uuid.Must(uuid.NewV7()),
		Role:   "platform_operator",
		Email:  "platform@example.com",
	})
}

func TestGetPlatformSettingsReturnsStoredTimezone(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	expectPlatformConfigLookup(mock, "America/Los_Angeles", now)

	resp, err := server.GetPlatformSettings(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultTimezone != "America/Los_Angeles" {
		t.Fatalf("default_timezone = %q, want America/Los_Angeles", resp.Msg.Settings.DefaultTimezone)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// A fresh install has no settings row yet, and the API still has to answer with
// a usable IANA name rather than an unset value.
func TestGetPlatformSettingsFallsBackWhenRowIsMissing(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformConfigQuery)).WillReturnError(sql.ErrNoRows)

	resp, err := server.GetPlatformSettings(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultTimezone != tenanttz.Default {
		t.Fatalf("default_timezone = %q, want %s", resp.Msg.Settings.DefaultTimezone, tenanttz.Default)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformSettingsPersistsTimezone(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta(testUpsertPlatformDefaultTimezoneQuery)).
		WithArgs("America/Los_Angeles").
		WillReturnRows(sqlmock.NewRows(platformConfigColumns()).AddRow(true, "America/Los_Angeles", now, now))
	expectOperatorAuditLogInsert(mock)

	resp, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		// Surrounding whitespace is normalized away before the value is stored.
		DefaultTimezone: "  America/Los_Angeles  ",
	}))
	if err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultTimezone != "America/Los_Angeles" {
		t.Fatalf("default_timezone = %q, want America/Los_Angeles", resp.Msg.Settings.DefaultTimezone)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformSettingsDatabaseErrorIsHidden(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(testUpsertPlatformDefaultTimezoneQuery)).
		WithArgs("America/Los_Angeles").
		WillReturnError(errors.New(`pq: relation "platform_config" does not exist`))

	_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "America/Los_Angeles",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("UpdatePlatformSettings code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformSettingsRejectsInvalidTimezone(t *testing.T) {
	tests := []struct {
		name     string
		timezone string
	}{
		{name: "unknown zone", timezone: "Mars/Olympus_Mons"},
		{name: "empty", timezone: ""},
		{name: "blank", timezone: "   "},
		{name: "process local zone", timezone: "Local"},
		{name: "utc offset", timezone: "+09:00"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)

			_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
				DefaultTimezone: tt.timezone,
			}))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdatePlatformSettings code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
			if !errors.Is(err, tenanttz.ErrInvalid) {
				t.Fatalf("UpdatePlatformSettings error = %v, want tenanttz.ErrInvalid", err)
			}
			// No upsert and no audit entry: the stored value must survive a rejected update.
			assertOperatorHandlerExpectations(t, mock)
		})
	}
}
