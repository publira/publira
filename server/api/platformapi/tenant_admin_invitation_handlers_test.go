package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/pagination"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

const (
	listTenantAdminInvitationsAscQuery  = "-- name: ListTenantAdminInvitationsAsc :many\n"
	listTenantAdminInvitationsDescQuery = "-- name: ListTenantAdminInvitationsDesc :many\n"
)

func tenantAdminInvitationColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"tenant_id",
		"email",
		"token_hash",
		"expires_at",
		"accepted_at",
		"canceled_at",
		"created_at",
		"updated_at",
	})
}

func addTenantAdminInvitationRow(
	rows *sqlmock.Rows,
	id, tenantID uuid.UUID,
	email string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(id, tenantID, email, "token-hash-"+id.String(), createdAt.Add(time.Hour), nil, nil, createdAt, createdAt)
}

func expectTenantForInvitationList(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))
}

func newTenantAdminInvitationListRequest() *connect.Request[publirasplatformv1.ListTenantAdminInvitationsRequest] {
	return connect.NewRequest(&publirasplatformv1.ListTenantAdminInvitationsRequest{TenantPublicId: "TENANT001"})
}

func TestListTenantAdminInvitationsFirstPageReportsNextToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}
	expectTenantForInvitationList(mock, tenantID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantAdminInvitationsDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addTenantAdminInvitationRow(
			addTenantAdminInvitationRow(
				addTenantAdminInvitationRow(tenantAdminInvitationColumns(), ids[0], tenantID, "first@example.com", now),
				ids[1], tenantID, "second@example.com", now.Add(-time.Minute),
			),
			ids[2], tenantID, "third@example.com", now.Add(-2*time.Minute),
		))

	req := newTenantAdminInvitationListRequest()
	req.Msg.Limit = 2
	resp, err := server.ListTenantAdminInvitations(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantAdminInvitations: %v", err)
	}
	if len(resp.Msg.Invitations) != 2 {
		t.Fatalf("invitation count = %d, want the over-fetched row dropped", len(resp.Msg.Invitations))
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantKeys := []string{now.Add(-time.Minute).Format(time.RFC3339Nano), ids[1].String()}
	if cursor.Direction != pagination.Forward || !slices.Equal(cursor.Keys, wantKeys) {
		t.Fatalf("next_token = %+v, want forward keys %v", cursor, wantKeys)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListTenantAdminInvitationsFollowsNextToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	expectTenantForInvitationList(mock, tenantID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantAdminInvitationsDescQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addTenantAdminInvitationRow(
			tenantAdminInvitationColumns(), uuid.Must(uuid.NewV7()), tenantID, "last@example.com", now.Add(-2*time.Minute),
		))

	req := newTenantAdminInvitationListRequest()
	req.Msg.Limit = 2
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID)
	resp, err := server.ListTenantAdminInvitations(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantAdminInvitations: %v", err)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the previous page")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListTenantAdminInvitationsFollowsPreviousTokenBackwards(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	expectTenantForInvitationList(mock, tenantID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantAdminInvitationsAscQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addTenantAdminInvitationRow(
			addTenantAdminInvitationRow(
				tenantAdminInvitationColumns(), uuid.Must(uuid.NewV7()), tenantID, "older@example.com", now.Add(-2*time.Minute),
			),
			uuid.Must(uuid.NewV7()), tenantID, "newer@example.com", now.Add(-time.Minute),
		))

	req := newTenantAdminInvitationListRequest()
	req.Msg.Limit = 2
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Backward, boundaryAt, boundaryID)
	resp, err := server.ListTenantAdminInvitations(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantAdminInvitations: %v", err)
	}
	emails := make([]string, 0, len(resp.Msg.Invitations))
	for _, invitation := range resp.Msg.Invitations {
		emails = append(emails, invitation.Email)
	}
	if !slices.Equal(emails, []string{"newer@example.com", "older@example.com"}) {
		t.Fatalf("emails = %v, want backward page restored to descending order", emails)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListTenantAdminInvitationsEmptyPageReturnsOneRecoveryToken(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		query     string
	}{
		{name: "forward", direction: pagination.Forward, query: listTenantAdminInvitationsDescQuery},
		{name: "backward", direction: pagination.Backward, query: listTenantAdminInvitationsAscQuery},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			expectTenantForInvitationList(mock, tenantID, now)
			mock.ExpectQuery(regexp.QuoteMeta(test.query)).
				WithArgs(tenantID, boundaryID, false, now, int32(21)).
				WillReturnRows(tenantAdminInvitationColumns())

			req := newTenantAdminInvitationListRequest()
			req.Msg.Token = pagination.EncodeTimeUUID(test.direction, now, boundaryID)
			resp, err := server.ListTenantAdminInvitations(context.Background(), req)
			if err != nil {
				t.Fatalf("ListTenantAdminInvitations: %v", err)
			}
			if test.direction == pagination.Forward {
				want := pagination.EncodeTimeUUIDRecovery(pagination.Backward, now, boundaryID)
				if resp.Msg.PreviousToken != want || resp.Msg.NextToken != "" {
					t.Fatalf("tokens = (%q, %q), want recovery previous token %q", resp.Msg.PreviousToken, resp.Msg.NextToken, want)
				}
			} else {
				want := pagination.EncodeTimeUUIDRecovery(pagination.Forward, now, boundaryID)
				if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != want {
					t.Fatalf("tokens = (%q, %q), want recovery next token %q", resp.Msg.PreviousToken, resp.Msg.NextToken, want)
				}
			}
			assertOperatorHandlerExpectations(t, mock)
		})
	}
}

func TestListTenantAdminInvitationsRejectsInvalidToken(t *testing.T) {
	tests := []string{
		"not-base64",
		pagination.Encode(pagination.Forward, "not-a-time", uuid.Must(uuid.NewV7()).String()),
		pagination.Encode(pagination.Forward, time.Now().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String(), "not-inclusive"),
	}

	for _, token := range tests {
		server, mock := newOperatorHandlerTestServer(t)
		req := newTenantAdminInvitationListRequest()
		req.Msg.Token = token
		_, err := server.ListTenantAdminInvitations(context.Background(), req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ListTenantAdminInvitations code = %v, want invalid_argument", connect.CodeOf(err))
		}
		assertOperatorHandlerExpectations(t, mock)
	}
}

type tenantInvitationRendererStub struct {
	request emailrenderer.Request
	err     error
}

func (s *tenantInvitationRendererStub) Render(_ context.Context, request emailrenderer.Request) (emailrenderer.Email, error) {
	s.request = request
	if s.err != nil {
		return emailrenderer.Email{}, s.err
	}
	return emailrenderer.Email{Subject: "招待", HTML: "<p>招待</p>", Text: "招待"}, nil
}

type tenantInvitationMailerStub struct {
	email internalsmtp.RenderedEmail
}

func (*tenantInvitationMailerStub) SendEmail(context.Context, emailsettings.SMTPSettings, string, string, string) error {
	return nil
}

func (s *tenantInvitationMailerStub) SendRenderedEmail(_ context.Context, _ emailsettings.SMTPSettings, _ string, email internalsmtp.RenderedEmail) error {
	s.email = email
	return nil
}

func TestSendTenantAdminInvitationEmailRendersAndSendsHTML(t *testing.T) {
	tests := []struct {
		name string
		// tenantLocale is the tenants.default_locale value the invited tenant
		// row carries; a blank one sends the resolver to the platform default.
		tenantLocale   string
		expectPlatform func(mock sqlmock.Sqlmock, now time.Time)
		wantLocale     string
	}{
		{name: "japanese tenant keeps ja", tenantLocale: "ja", wantLocale: "ja"},
		{name: "english tenant renders in en", tenantLocale: "en", wantLocale: "en"},
		{
			name: "blank tenant locale falls back to the platform default",
			expectPlatform: func(mock sqlmock.Sqlmock, now time.Time) {
				expectPlatformConfigLookup(mock, "Asia/Tokyo", "en", now)
			},
			wantLocale: "en",
		},
		{
			name: "unreadable platform config still sends, in ja",
			expectPlatform: func(mock sqlmock.Sqlmock, _ time.Time) {
				mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformConfigQuery)).
					WillReturnError(errors.New("platform config is unavailable"))
			},
			wantLocale: "ja",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			encryptor := newPasswordResetEncryptor(t)
			encrypted, err := encryptor.EncryptString("smtp-password")
			if err != nil {
				t.Fatalf("EncryptString: %v", err)
			}
			mock.ExpectQuery(regexp.QuoteMeta("-- name: GetTenantSMTPConfigByTenantID :one\n")).
				WithArgs(tenantID).
				WillReturnRows(sqlmock.NewRows([]string{"tenant_id", "smtp_override_enabled", "host", "port", "username", "password_encrypted", "encryption", "from_name", "from_address", "reply_to", "created_at", "updated_at"}).
					AddRow(tenantID, true, "smtp.example.com", 587, "mailer", encrypted, "starttls", "Publira", "no-reply@example.com", nil, now, now))
			if test.expectPlatform != nil {
				test.expectPlatform(mock, now)
			}
			renderer := &tenantInvitationRendererStub{}
			mailer := &tenantInvitationMailerStub{}
			server.encryptor = encryptor
			server.renderer = renderer
			server.mailer = mailer

			invitation := dbmodels.TenantAdminInvitation{
				Email:     "admin@example.com",
				ExpiresAt: now.Add(24 * time.Hour),
			}
			tenant := dbmodels.Tenant{
				ID:            tenantID,
				Name:          "Example Press",
				AdminDomain:   sql.NullString{String: "admin.example.com", Valid: true},
				Timezone:      "America/New_York",
				DefaultLocale: test.tenantLocale,
			}
			if err := server.sendTenantAdminInvitationEmail(context.Background(), tenant, invitation, "token"); err != nil {
				t.Fatalf("sendTenantAdminInvitationEmail: %v", err)
			}

			if renderer.request.Template != "tenant_admin_invitation" || renderer.request.Locale != test.wantLocale || renderer.request.TimeZone != "America/New_York" {
				t.Fatalf("render request = %+v, want locale %q", renderer.request, test.wantLocale)
			}
			if got := renderer.request.Data["invite_url"]; got != "https://admin.example.com/accept-invite?token=token" {
				t.Fatalf("invite_url = %q", got)
			}
			if got := renderer.request.Data["expires_at"]; got != invitation.ExpiresAt.Format(time.RFC3339Nano) {
				t.Fatalf("expires_at = %q", got)
			}
			if mailer.email != (internalsmtp.RenderedEmail{Subject: "招待", HTML: "<p>招待</p>", Text: "招待"}) {
				t.Fatalf("sent email = %+v", mailer.email)
			}
			assertOperatorHandlerExpectations(t, mock)
		})
	}
}

func TestRenderTenantAdminInvitationEmailMakesRendererFailureInternal(t *testing.T) {
	server := &platformServer{renderer: &tenantInvitationRendererStub{err: errors.New("renderer unavailable")}}
	_, err := server.renderTenantAdminInvitationEmail(context.Background(), dbmodels.Tenant{
		Name:          "Example Press",
		AdminDomain:   sql.NullString{String: "admin.example.com", Valid: true},
		Timezone:      "Asia/Tokyo",
		DefaultLocale: "ja",
	}, dbmodels.TenantAdminInvitation{ExpiresAt: time.Now().Add(time.Hour)}, "token")
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: failed to render tenant admin invitation email" {
		t.Fatalf("error = %q", err)
	}
}
