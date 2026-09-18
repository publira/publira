package publicapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/testutil"
)

// The contact form is the one reader-writable RPC a guest reaches, and what it
// stores is what the tenant's staff read back through their own RLS-bound role.
// These run against a real database, the way a request does.

// adminContactConsole is the inbox as these tests drive it: AdminContactService
// on the admin role, reached with a staff token.
type adminContactConsole struct {
	client publiraadminv1connect.AdminContactServiceClient
	token  string
	tenant testutil.Tenant
}

func (e *publicDBEnv) openAdminContactConsole(t *testing.T, tenant testutil.Tenant, staff testutil.TenantUser) adminContactConsole {
	t.Helper()

	console := e.openAdminConsole(t, tenant, staff)
	return adminContactConsole{
		client: publiraadminv1connect.NewAdminContactServiceClient(console.server.Client(), console.server.URL),
		token:  console.token,
		tenant: tenant,
	}
}

func (c adminContactConsole) list(t *testing.T, status string, limit int32, token string) *publiraadminv1.ListContactMessagesResponse {
	t.Helper()

	res, err := c.client.ListContactMessages(context.Background(), newBearerRequest(&publiraadminv1.ListContactMessagesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: c.tenant.ID.String()},
		Status: status,
		Limit:  limit,
		Token:  token,
	}, c.token))
	if err != nil {
		t.Fatalf("ListContactMessages(%q): %v", status, err)
	}
	return res.Msg
}

// submitContactMessage sends the form as a guest, which is how a reader who
// cannot sign in reaches the tenant.
func (e *publicDBEnv) submitContactMessage(
	t *testing.T,
	tenant testutil.Tenant,
	msg *publirav1.SubmitContactMessageRequest,
) error {
	t.Helper()

	msg.Tenant = tenantContext(tenant)
	_, err := e.contactClient().SubmitContactMessage(context.Background(), connect.NewRequest(msg))
	return err
}

func TestDBContactMessageFromAGuestReachesTheInbox(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT1", "contact1.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF1", "staff@contact1.example.com", "Staff")

	if err := env.submitContactMessage(t, tenant, &publirav1.SubmitContactMessageRequest{
		ReplyToEmail: "guest@example.test",
		Subject:      "  A question  ",
		Body:         "  Which episodes can I read without an account?  ",
	}); err != nil {
		t.Fatalf("SubmitContactMessage: %v", err)
	}

	console := env.openAdminContactConsole(t, tenant, staff)
	listed := console.list(t, "", 20, "")
	if len(listed.Messages) != 1 {
		t.Fatalf("listed %d messages, want 1", len(listed.Messages))
	}

	message := listed.Messages[0]
	if message.ReplyToEmail != "guest@example.test" {
		t.Errorf("reply_to_email = %q", message.ReplyToEmail)
	}
	// Both fields are stored trimmed, so trailing whitespace neither reaches
	// staff nor counts towards the length limits.
	if message.Subject != "A question" {
		t.Errorf("subject = %q", message.Subject)
	}
	if message.Body != "Which episodes can I read without an account?" {
		t.Errorf("body = %q", message.Body)
	}
	if message.SenderPublicId != "" || message.SenderName != "" {
		t.Errorf("a guest was attributed to %q / %q", message.SenderPublicId, message.SenderName)
	}
	if message.HandledAt != "" {
		t.Errorf("a new message is already handled at %q", message.HandledAt)
	}
	if message.CreatedAt == "" {
		t.Error("the message carries no received time")
	}
}

// The mail is queued in the transaction that stores the message, so staff learn
// about it without the submission waiting on a mail server.
func TestDBContactMessageQueuesTheStaffMail(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT2", "contact2.example.com", "Aoto Press")

	if err := env.submitContactMessage(t, tenant, &publirav1.SubmitContactMessageRequest{
		ReplyToEmail: "guest@example.test",
		Body:         "Please fix my date of birth.",
	}); err != nil {
		t.Fatalf("SubmitContactMessage: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Counted before it is read, because reading one row would pass just as
	// well on a submission that queued a second event under another key.
	var queued int
	if err := env.PG.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM outbox_events WHERE tenant_id = $1`, tenant.ID).Scan(&queued); err != nil {
		t.Fatalf("count the queued events: %v", err)
	}
	if queued != 1 {
		t.Fatalf("queued %d events, want 1", queued)
	}

	var eventType, idempotencyKey string
	if err := env.PG.DB.QueryRowContext(ctx, `
		SELECT event_type, idempotency_key
		FROM outbox_events
		WHERE tenant_id = $1
	`, tenant.ID).Scan(&eventType, &idempotencyKey); err != nil {
		t.Fatalf("read the queued event: %v", err)
	}
	if eventType != outbox.EventTypeContactMessageStaffEmail {
		t.Errorf("event_type = %q, want %q", eventType, outbox.EventTypeContactMessageStaffEmail)
	}
	if !strings.HasPrefix(idempotencyKey, outbox.EventTypeContactMessageStaffEmail+":") {
		t.Errorf("idempotency_key = %q", idempotencyKey)
	}
}

func TestDBContactMessageFromASignedInReaderCarriesTheAccount(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT3", "contact3.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF3", "staff@contact3.example.com", "Staff")
	reader := env.PG.SeedEndUser(t, tenant.ID, "CONTACTRDR3", "reader@contact3.example.com", "Rin Amagai")

	// The reply-to address is the reader's to choose, and is deliberately not
	// the one on their account: staff answer where they were asked to.
	if _, err := env.contactClient().SubmitContactMessage(context.Background(), newBearerRequest(&publirav1.SubmitContactMessageRequest{
		Tenant:       tenantContext(tenant),
		ReplyToEmail: "elsewhere@example.test",
		Body:         "The date of birth on my account is wrong.",
	}, tokenFor(t, tenant, reader))); err != nil {
		t.Fatalf("SubmitContactMessage: %v", err)
	}

	console := env.openAdminContactConsole(t, tenant, staff)
	listed := console.list(t, "", 20, "")
	if len(listed.Messages) != 1 {
		t.Fatalf("listed %d messages, want 1", len(listed.Messages))
	}
	message := listed.Messages[0]
	if message.SenderPublicId != reader.PublicID {
		t.Errorf("sender_public_id = %q, want %q", message.SenderPublicId, reader.PublicID)
	}
	if message.SenderName != "Rin Amagai" {
		t.Errorf("sender_name = %q", message.SenderName)
	}
	if message.ReplyToEmail != "elsewhere@example.test" {
		t.Errorf("reply_to_email = %q", message.ReplyToEmail)
	}
}

func TestDBContactMessageRefusesWhatTheColumnsCannotHold(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT4", "contact4.example.com", "Aoto Press")

	for _, testCase := range []struct {
		name    string
		message *publirav1.SubmitContactMessageRequest
	}{
		{
			name:    "no reply-to address",
			message: &publirav1.SubmitContactMessageRequest{Body: "Hello."},
		},
		{
			name:    "a reply-to address that is not one",
			message: &publirav1.SubmitContactMessageRequest{ReplyToEmail: "not-an-address", Body: "Hello."},
		},
		{
			// net/mail accepts `Name <a@b>`, which is not what a field labelled
			// "email address" asked the reader for.
			name:    "a reply-to address with a display name on it",
			message: &publirav1.SubmitContactMessageRequest{ReplyToEmail: "Rin <rin@example.test>", Body: "Hello."},
		},
		{
			name:    "a body of nothing but whitespace",
			message: &publirav1.SubmitContactMessageRequest{ReplyToEmail: "guest@example.test", Body: "   \n  "},
		},
		{
			name: "a body past the limit",
			message: &publirav1.SubmitContactMessageRequest{
				ReplyToEmail: "guest@example.test",
				Body:         strings.Repeat("あ", maxContactBodyRunes+1),
			},
		},
		{
			name: "a subject past the limit",
			message: &publirav1.SubmitContactMessageRequest{
				ReplyToEmail: "guest@example.test",
				Subject:      strings.Repeat("あ", maxContactSubjectRunes+1),
				Body:         "Hello.",
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := env.submitContactMessage(t, tenant, testCase.message)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("SubmitContactMessage = %v, want invalid_argument", err)
			}
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var stored int
	if err := env.PG.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM contact_messages WHERE tenant_id = $1`, tenant.ID).Scan(&stored); err != nil {
		t.Fatalf("count contact messages: %v", err)
	}
	if stored != 0 {
		t.Errorf("%d messages were stored by refused submissions", stored)
	}
}

// The client's allowance is the only one a guest spends, so it is what has to
// stop a form nobody is signed in to.
func TestDBContactMessageRefusesAGuestPastTheClientAllowance(t *testing.T) {
	guards := openReaderGuards()
	guards.rules[actionSubmitContactMessageFromClient] = []ratelimit.Rule{{Limit: 1, Window: time.Hour}}
	env := newPublicDBEnvWithGuards(t, guards)
	tenant := env.seedTenant(t, "CONTACT5", "contact5.example.com", "Aoto Press")

	if err := env.submitContactMessage(t, tenant, &publirav1.SubmitContactMessageRequest{
		ReplyToEmail: "guest@example.test",
		Body:         "The first question.",
	}); err != nil {
		t.Fatalf("the first SubmitContactMessage: %v", err)
	}

	err := env.submitContactMessage(t, tenant, &publirav1.SubmitContactMessageRequest{
		ReplyToEmail: "guest@example.test",
		Body:         "The second question.",
	})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second SubmitContactMessage = %v, want resource_exhausted", err)
	}
}

// The account's allowance is charged on top of the client's, so signing up does
// not widen what one client may send.
func TestDBContactMessageRefusesAReaderPastTheAccountAllowance(t *testing.T) {
	guards := openReaderGuards()
	guards.rules[actionSubmitContactMessage] = []ratelimit.Rule{{Limit: 1, Window: time.Hour}}
	env := newPublicDBEnvWithGuards(t, guards)
	tenant := env.seedTenant(t, "CONTACT6", "contact6.example.com", "Aoto Press")
	reader := env.PG.SeedEndUser(t, tenant.ID, "CONTACTRDR6", "reader@contact6.example.com", "Rin Amagai")
	token := tokenFor(t, tenant, reader)

	send := func(body string) error {
		_, err := env.contactClient().SubmitContactMessage(context.Background(), newBearerRequest(&publirav1.SubmitContactMessageRequest{
			Tenant:       tenantContext(tenant),
			ReplyToEmail: "reader@contact6.example.com",
			Body:         body,
		}, token))
		return err
	}

	if err := send("The first question."); err != nil {
		t.Fatalf("the first SubmitContactMessage: %v", err)
	}
	if err := send("The second question."); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second SubmitContactMessage = %v, want resource_exhausted", err)
	}
}

func TestDBContactMessageIsMarkedHandledAndPutBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT7", "contact7.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF7", "staff@contact7.example.com", "Staff")

	if err := env.submitContactMessage(t, tenant, &publirav1.SubmitContactMessageRequest{
		ReplyToEmail: "guest@example.test",
		Body:         "A question.",
	}); err != nil {
		t.Fatalf("SubmitContactMessage: %v", err)
	}

	console := env.openAdminContactConsole(t, tenant, staff)
	publicID := console.list(t, "unhandled", 20, "").Messages[0].PublicId

	marked, err := console.client.MarkContactMessageHandled(context.Background(), newBearerRequest(&publiraadminv1.MarkContactMessageHandledRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: publicID,
		Handled:  true,
	}, console.token))
	if err != nil {
		t.Fatalf("MarkContactMessageHandled(true): %v", err)
	}
	if marked.Msg.Message.HandledAt == "" {
		t.Fatal("the message was marked handled and carries no handled time")
	}
	handledAt := marked.Msg.Message.HandledAt

	// A second press is not a second handling, so the recorded time stands.
	again, err := console.client.MarkContactMessageHandled(context.Background(), newBearerRequest(&publiraadminv1.MarkContactMessageHandledRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: publicID,
		Handled:  true,
	}, console.token))
	if err != nil {
		t.Fatalf("the second MarkContactMessageHandled(true): %v", err)
	}
	if again.Msg.Message.HandledAt != handledAt {
		t.Errorf("handled_at moved from %q to %q", handledAt, again.Msg.Message.HandledAt)
	}

	if len(console.list(t, "unhandled", 20, "").Messages) != 0 {
		t.Error("a handled message is still in the unhandled list")
	}
	if len(console.list(t, "handled", 20, "").Messages) != 1 {
		t.Error("a handled message is not in the handled list")
	}

	reopened, err := console.client.MarkContactMessageHandled(context.Background(), newBearerRequest(&publiraadminv1.MarkContactMessageHandledRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: publicID,
		Handled:  false,
	}, console.token))
	if err != nil {
		t.Fatalf("MarkContactMessageHandled(false): %v", err)
	}
	if reopened.Msg.Message.HandledAt != "" {
		t.Errorf("a reopened message still carries handled_at = %q", reopened.Msg.Message.HandledAt)
	}
	if len(console.list(t, "unhandled", 20, "").Messages) != 1 {
		t.Error("a reopened message is not back in the unhandled list")
	}
}

func TestDBContactMessageIsReadableOneAtATime(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT8", "contact8.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF8", "staff@contact8.example.com", "Staff")

	if err := env.submitContactMessage(t, tenant, &publirav1.SubmitContactMessageRequest{
		ReplyToEmail: "guest@example.test",
		Body:         "A question.",
	}); err != nil {
		t.Fatalf("SubmitContactMessage: %v", err)
	}

	console := env.openAdminContactConsole(t, tenant, staff)
	publicID := console.list(t, "", 20, "").Messages[0].PublicId

	got, err := console.client.GetContactMessage(context.Background(), newBearerRequest(&publiraadminv1.GetContactMessageRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: publicID,
	}, console.token))
	if err != nil {
		t.Fatalf("GetContactMessage: %v", err)
	}
	if got.Msg.Message.Body != "A question." {
		t.Errorf("body = %q", got.Msg.Message.Body)
	}

	_, err = console.client.GetContactMessage(context.Background(), newBearerRequest(&publiraadminv1.GetContactMessageRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: "NOSUCHMSG01",
	}, console.token))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetContactMessage of a message that does not exist = %v, want not_found", err)
	}
}

// A message belongs to the tenant it was sent to, and to no other.
func TestDBContactMessageStaysOnItsOwnTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	firstStaff := env.PG.SeedTenantAdmin(t, first.ID, "CONTACTSTFA", "staff@tenant-a.example.com", "Staff A")
	secondStaff := env.PG.SeedTenantAdmin(t, second.ID, "CONTACTSTFB", "staff@tenant-b.example.com", "Staff B")

	if err := env.submitContactMessage(t, first, &publirav1.SubmitContactMessageRequest{
		ReplyToEmail: "guest@example.test",
		Body:         "A question for Tenant A.",
	}); err != nil {
		t.Fatalf("SubmitContactMessage: %v", err)
	}

	publicID := env.openAdminContactConsole(t, first, firstStaff).list(t, "", 20, "").Messages[0].PublicId

	other := env.openAdminContactConsole(t, second, secondStaff)
	if listed := other.list(t, "", 20, ""); len(listed.Messages) != 0 {
		t.Errorf("the other tenant listed %d of these messages", len(listed.Messages))
	}
	_, err := other.client.GetContactMessage(context.Background(), newBearerRequest(&publiraadminv1.GetContactMessageRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: second.ID.String()},
		PublicId: publicID,
	}, other.token))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetContactMessage across tenants = %v, want not_found", err)
	}
}
