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
	"github.com/jackc/pgx/v5/pgconn"

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
	// The console saves one field at a time and sends this back, so it is the
	// read's answer as much as the two values are.
	if resp.Msg.Settings.Revision != 1 {
		t.Fatalf("revision = %d, want 1", resp.Msg.Settings.Revision)
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
		WillReturnRows(platformConfigRow("Asia/Tokyo", "fr", 1, now))

	_, err := server.GetPlatformSettings(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformSettingsRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetPlatformSettings code = %v, want internal (err=%v)", connect.CodeOf(err), err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// expectPlatformSettingsWrite expects the whole save: the settings row locked
// for update, the write over it, and the commit that ends the transaction.
func expectPlatformSettingsWrite(
	mock sqlmock.Sqlmock,
	storedRevision int64,
	timezone, defaultLocale string,
	now time.Time,
) {
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testLockPlatformConfigQuery)).
		WillReturnRows(platformConfigRow("Europe/Berlin", "ja", storedRevision, now))
	mock.ExpectQuery(regexp.QuoteMeta(testUpdatePlatformSettingsQuery)).
		WithArgs(timezone, defaultLocale).
		WillReturnRows(platformConfigRow(timezone, defaultLocale, storedRevision+1, now))
	mock.ExpectCommit()
}

func TestUpdatePlatformSettingsPersistsTimezone(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	expectPlatformSettingsWrite(mock, 3, "America/Los_Angeles", "ja", now)
	expectOperatorAuditLogInsert(mock)

	resp, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		// Surrounding whitespace is normalized away before the value is stored.
		DefaultTimezone:  "  America/Los_Angeles  ",
		DefaultLocale:    "ja",
		ExpectedRevision: 3,
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
	// The saved row is one version further along, and the response says so, so
	// the screen can save again without reading first.
	if resp.Msg.Settings.Revision != 4 {
		t.Fatalf("revision = %d, want 4", resp.Msg.Settings.Revision)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformSettingsPersistsLocale(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	expectPlatformSettingsWrite(mock, 1, "America/Los_Angeles", "en", now)
	expectOperatorAuditLogInsert(mock)

	resp, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "America/Los_Angeles",
		DefaultLocale:    "  en  ",
		ExpectedRevision: 1,
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
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testLockPlatformConfigQuery)).
		WillReturnError(errors.New(`pq: relation "platform_config" does not exist`))
	mock.ExpectRollback()

	_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "America/Los_Angeles",
		DefaultLocale:    "ja",
		ExpectedRevision: 1,
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
				DefaultTimezone:  tt.timezone,
				DefaultLocale:    "ja",
				ExpectedRevision: 1,
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
				DefaultTimezone:  "America/Los_Angeles",
				DefaultLocale:    tt.locale,
				ExpectedRevision: 1,
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
				DefaultTimezone:  "America/Los_Angeles",
				DefaultLocale:    tt.locale,
				ExpectedRevision: 1,
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
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testLockPlatformConfigQuery)).
		WillReturnRows(platformConfigRow("Europe/Berlin", "ja", 1, now))
	mock.ExpectQuery(regexp.QuoteMeta(testUpdatePlatformSettingsQuery)).
		WithArgs("America/Los_Angeles", "en").
		WillReturnError(errors.New(`pq: could not serialize access`))
	mock.ExpectRollback()

	_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "America/Los_Angeles",
		DefaultLocale:    "en",
		ExpectedRevision: 1,
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("UpdatePlatformSettings code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	// A single statement inside the transaction means a failed write cannot
	// leave the timezone updated and the locale unchanged.
	assertOperatorHandlerExpectations(t, mock)
}

// The save states the revision it read. A stored row that has moved past it
// means another session wrote one of the two fields in between, and sending the
// other one back over it is exactly the reversion the revision exists to stop.
func TestUpdatePlatformSettingsRejectsAStaleRevision(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testLockPlatformConfigQuery)).
		WillReturnRows(platformConfigRow("Europe/Berlin", "en", 7, now))
	mock.ExpectRollback()

	_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "America/Los_Angeles",
		DefaultLocale:    "ja",
		ExpectedRevision: 6,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformSettings code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	// No update and no audit entry: the conflict is refused before anything is
	// written.
	assertOperatorHandlerExpectations(t, mock)
}

// Revision zero states that no settings row is expected yet, which is the only
// way one gets created here.
func TestUpdatePlatformSettingsCreatesTheRowForRevisionZero(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testLockPlatformConfigQuery)).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(testInsertPlatformSettingsQuery)).
		WithArgs("America/Los_Angeles", "en").
		WillReturnRows(platformConfigRow("America/Los_Angeles", "en", 1, now))
	mock.ExpectCommit()
	expectOperatorAuditLogInsert(mock)

	resp, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "America/Los_Angeles",
		DefaultLocale:    "en",
		ExpectedRevision: 0,
	}))
	if err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}
	if resp.Msg.Settings.Revision != 1 {
		t.Fatalf("revision = %d, want 1", resp.Msg.Settings.Revision)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// A save based on a row that has since been deleted has nothing to compare
// against, and creating one from those values would resurrect settings the
// caller never confirmed.
func TestUpdatePlatformSettingsRejectsAMissingRowForANamedRevision(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testLockPlatformConfigQuery)).WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "America/Los_Angeles",
		DefaultLocale:    "en",
		ExpectedRevision: 4,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformSettings code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// An absent row leaves nothing to lock, so two callers can reach the insert
// together. The primary key settles it, and the loser is told the row it meant
// to create now exists rather than handed an internal error.
func TestUpdatePlatformSettingsReportsALostInsertRaceAsAConflict(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testLockPlatformConfigQuery)).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(testInsertPlatformSettingsQuery)).
		WithArgs("America/Los_Angeles", "en").
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "platform_config_pkey"})
	mock.ExpectRollback()

	_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "America/Los_Angeles",
		DefaultLocale:    "en",
		ExpectedRevision: 0,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformSettings code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformSettingsRejectsANegativeRevision(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	_, err := server.UpdatePlatformSettings(newPlatformSettingsActorContext(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "America/Los_Angeles",
		DefaultLocale:    "en",
		ExpectedRevision: -1,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdatePlatformSettings code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	// Rejected before the transaction is opened at all.
	assertOperatorHandlerExpectations(t, mock)
}
