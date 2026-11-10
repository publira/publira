package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/tenantwebhooks"
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
		client: publiraadminv1connect.NewAdminContactServiceClient(connect.NewClient(connecthttp.NewTransport(console.server.Client(), console.server.URL))),
		token:  console.token,
		tenant: tenant,
	}
}

func (c adminContactConsole) list(t *testing.T, status string, limit int32, token string) *publiraadminv1.ListContactMessagesResponse {
	t.Helper()

	res, err := c.client.ListContactMessages(testutil.WithBearer(context.Background(), c.token), &publiraadminv1.ListContactMessagesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: c.tenant.ID.String()},
		Status: status,
		Limit:  limit,
		Token:  token,
	})
	if err != nil {
		t.Fatalf("ListContactMessages(%q): %v", status, err)
	}
	return res
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
	_, err := e.contactClient().SubmitContactMessage(context.Background(), msg)
	return err
}

func TestDBContactMessageFromAGuestReachesTheInbox(t *testing.T) {
	t.Parallel()

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
	t.Parallel()

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

// Every message is a row of its own, with a staff mail of its own, rather than
// the first one standing in for all that follow.
func TestDBContactMessagesAreStoredSeparately(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT9", "contact9.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF9", "staff@contact9.example.com", "Staff")

	for _, replyTo := range []string{"first@example.test", "second@example.test"} {
		if err := env.submitContactMessage(t, tenant, &publirav1.SubmitContactMessageRequest{
			ReplyToEmail: replyTo,
			Body:         "Which episodes can I read without an account?",
		}); err != nil {
			t.Fatalf("SubmitContactMessage from %s: %v", replyTo, err)
		}
	}

	listed := env.openAdminContactConsole(t, tenant, staff).list(t, "", 20, "")
	if len(listed.Messages) != 2 {
		t.Fatalf("listed %d messages, want 2", len(listed.Messages))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var mails int
	if err := env.PG.DB.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT idempotency_key) FROM outbox_events WHERE tenant_id = $1 AND event_type = $2`,
		tenant.ID, outbox.EventTypeContactMessageStaffEmail,
	).Scan(&mails); err != nil {
		t.Fatalf("count the queued mails: %v", err)
	}
	if mails != 2 {
		t.Fatalf("queued %d staff mails, want 2", mails)
	}
}

func TestDBContactMessageFromASignedInReaderCarriesTheAccount(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT3", "contact3.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF3", "staff@contact3.example.com", "Staff")
	reader := env.PG.SeedEndUser(t, tenant.ID, "CONTACTRDR3", "reader@contact3.example.com", "Rin Amagai")

	// The reply-to address is the reader's to choose, and is deliberately not
	// the one on their account: staff answer where they were asked to.
	if _, err := env.contactClient().SubmitContactMessage(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), &publirav1.SubmitContactMessageRequest{
		Tenant:       tenantContext(tenant),
		ReplyToEmail: "elsewhere@example.test",
		Body:         "The date of birth on my account is wrong.",
	}); err != nil {
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
	t.Parallel()

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
	t.Parallel()

	env := newPublicDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.Community.ContactMessagePerClient = platformpolicy.HourDay{PerHour: 1, PerDay: 1}
	}))
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
	t.Parallel()

	env := newPublicDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.Community.ContactMessagePerAccount = platformpolicy.HourDay{PerHour: 1, PerDay: 1}
	}))
	tenant := env.seedTenant(t, "CONTACT6", "contact6.example.com", "Aoto Press")
	reader := env.PG.SeedEndUser(t, tenant.ID, "CONTACTRDR6", "reader@contact6.example.com", "Rin Amagai")
	token := tokenFor(t, tenant, reader)

	send := func(body string) error {
		_, err := env.contactClient().SubmitContactMessage(testutil.WithBearer(context.Background(), token), &publirav1.SubmitContactMessageRequest{
			Tenant:       tenantContext(tenant),
			ReplyToEmail: "reader@contact6.example.com",
			Body:         body,
		})
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
	t.Parallel()

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
	listed := console.list(t, "unhandled", 20, "").Messages[0]
	if _, err := uuid.Parse(listed.Id); err != nil {
		t.Fatalf("the listed message carries no primary key: id = %q", listed.Id)
	}

	marked, err := console.client.MarkContactMessageHandled(testutil.WithBearer(context.Background(), console.token), &publiraadminv1.MarkContactMessageHandledRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		ContactMessageId: listed.Id,
		Handled:          true,
	})
	if err != nil {
		t.Fatalf("MarkContactMessageHandled(true): %v", err)
	}
	if marked.Message.HandledAt == "" {
		t.Fatal("the message was marked handled and carries no handled time")
	}
	handledAt := marked.Message.HandledAt

	// A second press is not a second handling, so the recorded time stands.
	again, err := console.client.MarkContactMessageHandled(testutil.WithBearer(context.Background(), console.token), &publiraadminv1.MarkContactMessageHandledRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		ContactMessageId: listed.Id,
		Handled:          true,
	})
	if err != nil {
		t.Fatalf("the second MarkContactMessageHandled(true): %v", err)
	}
	if again.Message.HandledAt != handledAt {
		t.Errorf("handled_at moved from %q to %q", handledAt, again.Message.HandledAt)
	}

	if len(console.list(t, "unhandled", 20, "").Messages) != 0 {
		t.Error("a handled message is still in the unhandled list")
	}
	if len(console.list(t, "handled", 20, "").Messages) != 1 {
		t.Error("a handled message is not in the handled list")
	}

	reopened, err := console.client.MarkContactMessageHandled(testutil.WithBearer(context.Background(), console.token), &publiraadminv1.MarkContactMessageHandledRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		ContactMessageId: listed.Id,
		Handled:          false,
	})
	if err != nil {
		t.Fatalf("MarkContactMessageHandled(false): %v", err)
	}
	if reopened.Message.HandledAt != "" {
		t.Errorf("a reopened message still carries handled_at = %q", reopened.Message.HandledAt)
	}
	if len(console.list(t, "unhandled", 20, "").Messages) != 1 {
		t.Error("a reopened message is not back in the unhandled list")
	}

	_, err = console.client.MarkContactMessageHandled(testutil.WithBearer(context.Background(), console.token), &publiraadminv1.MarkContactMessageHandledRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		ContactMessageId: "not-a-uuid",
		Handled:          true,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("MarkContactMessageHandled with a malformed contact_message_id = %v, want invalid_argument", err)
	}
}

func TestDBContactMessageIsReadableOneAtATime(t *testing.T) {
	t.Parallel()

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

	got, err := console.client.GetContactMessage(testutil.WithBearer(context.Background(), console.token), &publiraadminv1.GetContactMessageRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: publicID,
	})
	if err != nil {
		t.Fatalf("GetContactMessage: %v", err)
	}
	if got.Message.Body != "A question." {
		t.Errorf("body = %q", got.Message.Body)
	}

	_, err = console.client.GetContactMessage(testutil.WithBearer(context.Background(), console.token), &publiraadminv1.GetContactMessageRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: "NOSUCHMSG01",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetContactMessage of a message that does not exist = %v, want not_found", err)
	}
}

// A message belongs to the tenant it was sent to, and to no other.
func TestDBContactMessageStaysOnItsOwnTenant(t *testing.T) {
	t.Parallel()

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

	message := env.openAdminContactConsole(t, first, firstStaff).list(t, "", 20, "").Messages[0]

	other := env.openAdminContactConsole(t, second, secondStaff)
	if listed := other.list(t, "", 20, ""); len(listed.Messages) != 0 {
		t.Errorf("the other tenant listed %d of these messages", len(listed.Messages))
	}
	_, err := other.client.GetContactMessage(testutil.WithBearer(context.Background(), other.token), &publiraadminv1.GetContactMessageRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: second.ID.String()},
		PublicId: message.PublicId,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetContactMessage across tenants = %v, want not_found", err)
	}
	_, err = other.client.MarkContactMessageHandled(testutil.WithBearer(context.Background(), other.token), &publiraadminv1.MarkContactMessageHandledRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: second.ID.String()},
		ContactMessageId: message.Id,
		Handled:          true,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("MarkContactMessageHandled across tenants = %v, want not_found", err)
	}
}

// subscribeToContactMessages saves an endpoint on the tenant that subscribed
// to contact_message.received, and one beside it that did not.
func subscribeToContactMessages(t *testing.T, db *sql.DB, tenantID uuid.UUID) {
	t.Helper()

	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $3, 'https://helpdesk.example.com/publira', 'sealed', 'whsec_••••', ARRAY['contact_message.received']),
			($2, $3, 'https://cms.example.com/publira', 'sealed', 'whsec_••••', ARRAY['comment.posted'])
	`, uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), tenantID); err != nil {
		t.Fatalf("insert webhook endpoints: %v", err)
	}
}

// contactMessageDeliveries answers the data of every contact_message.received
// delivery owed on the tenant, oldest first, each to the endpoint that
// subscribed to it. It fails on data that names the address the reader asked
// to be answered at.
func contactMessageDeliveries(t *testing.T, db *sql.DB, tenantID uuid.UUID) []tenantwebhooks.ContactMessage {
	t.Helper()

	rows, err := db.QueryContext(context.Background(), `
		SELECT e.url, d.payload->'data'
		FROM webhook_deliveries d
			JOIN tenant_webhook_endpoints e ON e.tenant_id = d.tenant_id AND e.id = d.endpoint_id
		WHERE d.tenant_id = $1 AND d.event_type = 'contact_message.received'
		ORDER BY d.created_at, d.id
	`, tenantID)
	if err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []tenantwebhooks.ContactMessage
	for rows.Next() {
		var url string
		var raw []byte
		if err := rows.Scan(&url, &raw); err != nil {
			t.Fatalf("scan webhook delivery: %v", err)
		}
		if url != "https://helpdesk.example.com/publira" {
			t.Errorf("a delivery is owed to %s, which did not subscribe to it", url)
		}
		if strings.Contains(string(raw), "@") {
			t.Errorf("data = %s, want no address in it", raw)
		}
		var data tenantwebhooks.ContactMessage
		if err := json.Unmarshal(raw, &data); err != nil {
			t.Fatalf("decode webhook delivery: %v", err)
		}
		got = append(got, data)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	return got
}

// A message sent through the form owes contact_message.received once, in the
// transaction that stores it: a guest's names no reader, a signed-in reader's
// names their account, and neither carries the address to answer at.
func TestDBContactMessageOwesContactMessageReceived(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACTWH1", "contact-webhook.example.com", "Aoto Press")
	reader := env.PG.SeedEndUser(t, tenant.ID, "CONTACTWHR1", "reader@contact-webhook.example.com", "Rin Amagai")
	subscribeToContactMessages(t, env.PG.DB, tenant.ID)

	if err := env.submitContactMessage(t, tenant, &publirav1.SubmitContactMessageRequest{
		ReplyToEmail: "guest@example.test",
		Body:         "Which episodes can I read without an account?",
	}); err != nil {
		t.Fatalf("SubmitContactMessage (guest): %v", err)
	}
	if _, err := env.contactClient().SubmitContactMessage(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), &publirav1.SubmitContactMessageRequest{
		Tenant:       tenantContext(tenant),
		ReplyToEmail: "elsewhere@example.test",
		Subject:      "My date of birth",
		Body:         "The date of birth on my account is wrong.",
	}); err != nil {
		t.Fatalf("SubmitContactMessage (reader): %v", err)
	}

	var publicIDs []string
	rows, err := env.PG.DB.QueryContext(context.Background(), `
		SELECT public_id FROM contact_messages WHERE tenant_id = $1 ORDER BY created_at, id
	`, tenant.ID)
	if err != nil {
		t.Fatalf("read contact messages: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	for rows.Next() {
		var publicID string
		if err := rows.Scan(&publicID); err != nil {
			t.Fatalf("scan contact message: %v", err)
		}
		publicIDs = append(publicIDs, publicID)
	}
	if len(publicIDs) != 2 {
		t.Fatalf("stored %d contact messages, want 2", len(publicIDs))
	}

	got := contactMessageDeliveries(t, env.PG.DB, tenant.ID)
	if len(got) != 2 {
		t.Fatalf("owed %d contact_message.received deliveries, want 2: %+v", len(got), got)
	}
	guest, signedIn := got[0], got[1]
	if guest.MessagePublicID != publicIDs[0] || guest.Reply || guest.Subject != "" ||
		guest.Body != "Which episodes can I read without an account?" ||
		guest.ReaderPublicID != "" || guest.ReaderName != "" || guest.ReceivedAt == "" {
		t.Errorf("guest's message = %+v, want message %s with no subject and no reader", guest, publicIDs[0])
	}
	if signedIn.MessagePublicID != publicIDs[1] || signedIn.Reply || signedIn.Subject != "My date of birth" ||
		signedIn.Body != "The date of birth on my account is wrong." ||
		signedIn.ReaderPublicID != reader.PublicID || signedIn.ReaderName != "Rin Amagai" || signedIn.ReceivedAt == "" {
		t.Errorf("reader's message = %+v, want message %s from %s", signedIn, publicIDs[1], reader.PublicID)
	}
}
