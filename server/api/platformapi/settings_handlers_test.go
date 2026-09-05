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

	"github.com/publira/publira/server/internal/locale"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
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
	expectPlatformConfigLookup(mock, "America/Los_Angeles", "en", now)

	resp, err := server.GetPlatformSettings(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultTimezone != "America/Los_Angeles" {
		t.Fatalf("default_timezone = %q, want America/Los_Angeles", resp.Msg.Settings.DefaultTimezone)
	}
	if resp.Msg.Settings.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.Settings.DefaultLocale)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// The settings screen is where the platform's saved language is edited. A row
// it could not read leaves nothing to display, and answering with a stand-in is
// how the screen would come to save a language nobody chose over the stored one.
func TestGetPlatformSettingsFailsWhenRowIsMissing(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformConfigQuery)).WillReturnError(sql.ErrNoRows)

	_, err := server.GetPlatformSettings(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformSettingsRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetPlatformSettings code = %v, want internal (err=%v)", connect.CodeOf(err), err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// A code no catalog in this build covers cannot be rendered, and the operator
// has to be told rather than shown the console in another language.
func TestGetPlatformSettingsFailsOnAnUnsupportedStoredLocale(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformConfigQuery)).
		WillReturnRows(sqlmock.NewRows(platformConfigColumns()).AddRow(true, "Asia/Tokyo", "fr", now, now))

	_, err := server.GetPlatformSettings(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformSettingsRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetPlatformSettings code = %v, want internal (err=%v)", connect.CodeOf(err), err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformSettingsPersistsTimezone(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta(testUpsertPlatformSettingsQuery)).
		WithArgs("America/Los_Angeles", "ja").
		WillReturnRows(sqlmock.NewRows(platformConfigColumns()).AddRow(true, "America/Los_Angeles", "ja", now, now))
	expectOperatorAuditLogInsert(mock)

	resp, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		// Surrounding whitespace is normalized away before the value is stored.
		DefaultTimezone: "  America/Los_Angeles  ",
		DefaultLocale:   "ja",
	}))
	if err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultTimezone != "America/Los_Angeles" {
		t.Fatalf("default_timezone = %q, want America/Los_Angeles", resp.Msg.Settings.DefaultTimezone)
	}
	if resp.Msg.Settings.DefaultLocale != "ja" {
		t.Fatalf("default_locale = %q, want ja", resp.Msg.Settings.DefaultLocale)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformSettingsPersistsLocale(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta(testUpsertPlatformSettingsQuery)).
		WithArgs("America/Los_Angeles", "en").
		WillReturnRows(sqlmock.NewRows(platformConfigColumns()).AddRow(true, "America/Los_Angeles", "en", now, now))
	expectOperatorAuditLogInsert(mock)

	resp, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "America/Los_Angeles",
		DefaultLocale:   "  en  ",
	}))
	if err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultTimezone != "America/Los_Angeles" {
		t.Fatalf("default_timezone = %q, want America/Los_Angeles", resp.Msg.Settings.DefaultTimezone)
	}
	if resp.Msg.Settings.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.Settings.DefaultLocale)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformSettingsDatabaseErrorIsHidden(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(testUpsertPlatformSettingsQuery)).
		WithArgs("America/Los_Angeles", "ja").
		WillReturnError(errors.New(`pq: relation "platform_config" does not exist`))

	_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "America/Los_Angeles",
		DefaultLocale:   "ja",
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
				DefaultLocale:   "ja",
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

func TestUpdatePlatformSettingsRejectsInvalidLocale(t *testing.T) {
	tests := []struct {
		name   string
		locale string
	}{
		{name: "unknown code", locale: "fr"},
		{name: "wrong case", locale: "EN"},
		{name: "bcp47 region", locale: "en-US"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)

			_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
				DefaultTimezone: "America/Los_Angeles",
				DefaultLocale:   tt.locale,
			}))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdatePlatformSettings code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
			if !errors.Is(err, locale.ErrInvalid) {
				t.Fatalf("UpdatePlatformSettings error = %v, want locale.ErrInvalid", err)
			}
			// No upsert and no audit entry: the stored timezone must survive a rejected locale.
			assertOperatorHandlerExpectations(t, mock)
		})
	}
}

// The locale is required, so an omitted field arrives as the empty string and
// is rejected the same way a blank one is: the settings row has no column
// default left to fall back on.
func TestUpdatePlatformSettingsRejectsMissingLocale(t *testing.T) {
	tests := []struct {
		name   string
		locale string
	}{
		{name: "empty", locale: ""},
		{name: "blank", locale: "   "},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)

			_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
				DefaultTimezone: "America/Los_Angeles",
				DefaultLocale:   tt.locale,
			}))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdatePlatformSettings code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
			if !errors.Is(err, locale.ErrInvalid) {
				t.Fatalf("UpdatePlatformSettings error = %v, want locale.ErrInvalid", err)
			}
			assertOperatorHandlerExpectations(t, mock)
		})
	}
}

func TestUpdatePlatformSettingsWritesTimezoneAndLocaleAtomically(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(testUpsertPlatformSettingsQuery)).
		WithArgs("America/Los_Angeles", "en").
		WillReturnError(errors.New(`pq: could not serialize access`))

	_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "America/Los_Angeles",
		DefaultLocale:   "en",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("UpdatePlatformSettings code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	// A single upsert means a failed write cannot leave timezone updated and locale unchanged.
	assertOperatorHandlerExpectations(t, mock)
}
