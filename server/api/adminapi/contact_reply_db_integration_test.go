package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
)

func (e *adminDBEnv) contactClient() publiraadminv1connect.AdminContactServiceClient {
	return publiraadminv1connect.NewAdminContactServiceClient(e.Server.Client(), e.Server.URL)
}

// seedContactMessage stores one message a guest sent the tenant, the way the
// public form does, and returns its primary key.
func (e *adminDBEnv) seedContactMessage(t *testing.T, tenant adminDBTenant, publicID string, subject sql.NullString) string {
	t.Helper()

	id := uuid.Must(uuid.NewV7())
	if _, err := e.PG.DB.ExecContext(t.Context(),
		`INSERT INTO contact_messages (id, tenant_id, public_id, reply_to_email, subject, body) VALUES ($1, $2, $3, $4, $5, $6)`,
		id, tenant.Tenant.ID, publicID, "reader@example.test", subject, "The date of birth on my account is wrong.",
	); err != nil {
		t.Fatalf("seed contact message: %v", err)
	}
	return id.String()
}

func (e *adminDBEnv) replyToContactMessage(tenant adminDBTenant, messageID, body string) (*publiraadminv1.ContactMessage, error) {
	res, err := e.contactClient().ReplyToContactMessage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReplyToContactMessageRequest{
		Tenant:           tenant.tenantContext(),
		ContactMessageId: messageID,
		Body:             body,
	}))
	if err != nil {
		return nil, err
	}
	return res.Msg.Message, nil
}

func (e *adminDBEnv) getContactMessage(t *testing.T, tenant adminDBTenant, publicID string) *publiraadminv1.ContactMessage {
	t.Helper()

	res, err := e.contactClient().GetContactMessage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetContactMessageRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: publicID,
	}))
	if err != nil {
		t.Fatalf("GetContactMessage: %v", err)
	}
	return res.Msg.Message
}

// storedReplyEmailEvents are the mails queued for a message's answers, in the
// order they were queued.
func (e *adminDBEnv) storedReplyEmailEvents(t *testing.T, tenant adminDBTenant) []outbox.ContactMessageReplyEmailPayload {
	t.Helper()

	rows, err := e.PG.DB.QueryContext(t.Context(),
		`SELECT payload, idempotency_key FROM outbox_events WHERE tenant_id = $1 AND event_type = $2 ORDER BY created_at, id`,
		tenant.Tenant.ID, outbox.EventTypeContactMessageReplyEmail,
	)
	if err != nil {
		t.Fatalf("read reply email events: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var payloads []outbox.ContactMessageReplyEmailPayload
	for rows.Next() {
		var raw []byte
		var key string
		if err := rows.Scan(&raw, &key); err != nil {
			t.Fatalf("scan reply email event: %v", err)
		}
		var payload outbox.ContactMessageReplyEmailPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("decode reply email event: %v", err)
		}
		if want := outbox.ContactMessageReplyEmailIdempotencyKey(uuid.MustParse(payload.EntryID)); key != want {
			t.Errorf("idempotency key = %q, want %q", key, want)
		}
		payloads = append(payloads, payload)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read reply email events: %v", err)
	}
	return payloads
}

func TestDBReplyToContactMessageStoresTheAnswerAndQueuesItsMail(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "CONTACTRPL1", "aoto.example.test", "Aoto Press", "CONTACTRPLA1", "kei@aoto.example.test")
	messageID := env.seedContactMessage(t, tenant, "CONTACTRPLM1", sql.NullString{String: "Wrong date of birth", Valid: true})

	answered, err := env.replyToContactMessage(tenant, messageID, "  We have corrected it.\nSorry for the trouble.  ")
	if err != nil {
		t.Fatalf("ReplyToContactMessage: %v", err)
	}
	if answered.Status != contactMessageStatusHandled || answered.HandledAt == "" {
		t.Errorf("status = %q, handled_at = %q, want the answered message handled", answered.Status, answered.HandledAt)
	}
	if len(answered.Entries) != 1 || answered.EntryCount != 1 {
		t.Fatalf("entries = %d, entry_count = %d, want the one answer", len(answered.Entries), answered.EntryCount)
	}
	entry := answered.Entries[0]
	if entry.Direction != "staff" || entry.Body != "We have corrected it.\nSorry for the trouble." {
		t.Errorf("entry = (%q, %q), want the trimmed staff answer", entry.Direction, entry.Body)
	}
	if entry.AuthorUserId != tenant.User.ID.String() || entry.AuthorPublicId != tenant.User.PublicID || entry.AuthorName != tenant.User.Name {
		t.Errorf("author = (%q, %q, %q), want the caller", entry.AuthorUserId, entry.AuthorPublicId, entry.AuthorName)
	}

	var handledBy uuid.NullUUID
	var mailID sql.NullString
	if err := env.PG.DB.QueryRowContext(t.Context(), `SELECT handled_by FROM contact_messages WHERE id = $1`, messageID).Scan(&handledBy); err != nil {
		t.Fatalf("read handled_by: %v", err)
	}
	if handledBy.UUID != tenant.User.ID {
		t.Errorf("handled_by = %v, want the author", handledBy)
	}
	if err := env.PG.DB.QueryRowContext(t.Context(), `SELECT message_id FROM contact_message_entries WHERE id = $1`, entry.Id).Scan(&mailID); err != nil {
		t.Fatalf("read message_id: %v", err)
	}
	if !strings.HasSuffix(mailID.String, "@aoto.example.test") {
		t.Errorf("message_id = %q, want one on the tenant's domain", mailID.String)
	}

	events := env.storedReplyEmailEvents(t, tenant)
	if len(events) != 1 || events[0].EntryID != entry.Id || events[0].TenantID != tenant.Tenant.ID.String() {
		t.Fatalf("queued reply mails = %+v, want one for entry %s", events, entry.Id)
	}

	// The audit log names the message, and what was said stays under it.
	logs := env.readerAuditLogs(t, tenant)
	if len(logs) == 0 {
		t.Fatal("the answer was not audited")
	}
	record := logs[0]
	if record.Action != "contact_message_replied" || record.TargetType != "contact_message" || record.TargetId != "CONTACTRPLM1" ||
		record.ActorUserPublicId != tenant.User.PublicID || record.Outcome != "success" {
		t.Errorf("audit entry = %+v, want contact_message_replied of CONTACTRPLM1", record)
	}
	if raw, err := json.Marshal(record); err != nil || strings.Contains(string(raw), "corrected") {
		t.Errorf("the audit entry carries the answer: %s", raw)
	}
}

// A colleague opening the message sees it answered and handled, with every
// answer under it in the order they were sent. The first person to answer
// stays the one who handled it.
func TestDBContactMessageAnsweredByOneMemberOfStaffShowsToAColleague(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "CONTACTRPL2", "aoto2.example.test", "Aoto Press", "CONTACTRPLA2", "kei@aoto2.example.test")
	colleague := tenant.as(env.PG.SeedTenantAdmin(t, tenant.Tenant.ID, "CONTACTRPLB2", "mio@aoto2.example.test", "Mio Sato"))
	messageID := env.seedContactMessage(t, tenant, "CONTACTRPLM2", sql.NullString{})

	if _, err := env.replyToContactMessage(tenant, messageID, "The first answer."); err != nil {
		t.Fatalf("ReplyToContactMessage: %v", err)
	}

	seen := env.getContactMessage(t, colleague, "CONTACTRPLM2")
	if seen.Status != contactMessageStatusHandled {
		t.Errorf("status = %q to a colleague, want handled", seen.Status)
	}
	if len(seen.Entries) != 1 || seen.Entries[0].Body != "The first answer." || seen.Entries[0].AuthorName != tenant.User.Name {
		t.Fatalf("entries = %+v to a colleague, want the first answer", seen.Entries)
	}

	if _, err := env.replyToContactMessage(colleague, messageID, "A second answer."); err != nil {
		t.Fatalf("ReplyToContactMessage by a colleague: %v", err)
	}
	seen = env.getContactMessage(t, tenant, "CONTACTRPLM2")
	if len(seen.Entries) != 2 || seen.Entries[0].Body != "The first answer." || seen.Entries[1].Body != "A second answer." {
		t.Fatalf("entries = %+v, want both answers, newest last", seen.Entries)
	}
	if seen.Entries[1].AuthorUserId != colleague.User.ID.String() {
		t.Errorf("the second answer names %q, want the colleague", seen.Entries[1].AuthorUserId)
	}
	if got := env.countRows(t, `SELECT count(*) FROM contact_messages WHERE id = $1 AND handled_by = $2`, messageID, tenant.User.ID); got != 1 {
		t.Error("a second answer moved handled_by off the first member of staff to answer")
	}
	if events := env.storedReplyEmailEvents(t, tenant); len(events) != 2 {
		t.Errorf("queued reply mails = %d, want one per answer", len(events))
	}

	// The inbox does not carry what was said, only how much.
	res, err := env.contactClient().ListContactMessages(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListContactMessagesRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListContactMessages: %v", err)
	}
	listed := res.Msg.Messages
	if len(listed) != 1 || listed[0].EntryCount != 2 || len(listed[0].Entries) != 0 {
		t.Fatalf("listed = %+v, want entry_count 2 and no entries", listed)
	}
}

func TestDBReplyToContactMessageRefusesAnAnswerItCannotStore(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "CONTACTRPL3", "aoto3.example.test", "Aoto Press", "CONTACTRPLA3", "kei@aoto3.example.test")
	messageID := env.seedContactMessage(t, tenant, "CONTACTRPLM3", sql.NullString{})

	for name, body := range map[string]string{
		"blank":          " \n\t ",
		"past the limit": strings.Repeat("あ", 4001),
	} {
		if _, err := env.replyToContactMessage(tenant, messageID, body); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("ReplyToContactMessage with a %s answer = %v, want invalid_argument", name, err)
		}
	}
	// The limit counts characters, so an answer in any script may be as long.
	if _, err := env.replyToContactMessage(tenant, messageID, strings.Repeat("あ", 4000)); err != nil {
		t.Errorf("ReplyToContactMessage at the limit: %v", err)
	}
	if _, err := env.replyToContactMessage(tenant, "not-an-id", "An answer."); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("ReplyToContactMessage with a malformed id = %v, want invalid_argument", err)
	}
	if _, err := env.replyToContactMessage(tenant, uuid.Must(uuid.NewV7()).String(), "An answer."); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("ReplyToContactMessage for no message = %v, want not_found", err)
	}
	if got := env.countRows(t, `SELECT count(*) FROM contact_message_entries WHERE tenant_id = $1`, tenant.Tenant.ID); got != 1 {
		t.Errorf("stored entries = %d, want the one answer at the limit", got)
	}
}

func TestDBReplyToContactMessageStaysWithTheTenantsAdmins(t *testing.T) {
	env := newAdminDBEnv(t)
	first := env.seedTenantWithAdmin(t, "CONTACTRPL4", "aoto4.example.test", "Aoto Press", "CONTACTRPLA4", "kei@aoto4.example.test")
	second := env.seedTenantWithAdmin(t, "CONTACTRPL5", "other.example.test", "Other Press", "CONTACTRPLA5", "admin@other.example.test")
	editor := first.as(env.PG.SeedTenantUser(t, first.Tenant.ID, "CONTACTRPLE4", "editor@aoto4.example.test", "Editor", auth.RoleTenantEditor))
	messageID := env.seedContactMessage(t, first, "CONTACTRPLM4", sql.NullString{})

	if _, err := env.replyToContactMessage(editor, messageID, "An answer."); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("ReplyToContactMessage as an editor = %v, want permission_denied", err)
	}
	if _, err := env.replyToContactMessage(second, messageID, "An answer."); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("ReplyToContactMessage across tenants = %v, want not_found", err)
	}

	if got := env.countRows(t, `SELECT count(*) FROM contact_message_entries`); got != 0 {
		t.Errorf("stored entries = %d, want none", got)
	}
	if got := env.countRows(t, `SELECT count(*) FROM outbox_events WHERE event_type = $1`, outbox.EventTypeContactMessageReplyEmail); got != 0 {
		t.Errorf("queued reply mails = %d, want none", got)
	}
	if got := env.countRows(t, `SELECT count(*) FROM contact_messages WHERE id = $1 AND handled_at IS NULL`, messageID); got != 1 {
		t.Error("a refused answer marked the message handled")
	}
}

// The message survives the account of the member of staff who answered it,
// and so does the answer.
func TestDBContactMessageAnswerOutlivesItsAuthorsAccount(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "CONTACTRPL6", "aoto6.example.test", "Aoto Press", "CONTACTRPLA6", "kei@aoto6.example.test")
	leaving := tenant.as(env.PG.SeedTenantAdmin(t, tenant.Tenant.ID, "CONTACTRPLL6", "leaving@aoto6.example.test", "Leaving"))
	messageID := env.seedContactMessage(t, tenant, "CONTACTRPLM6", sql.NullString{})
	if _, err := env.replyToContactMessage(leaving, messageID, "An answer."); err != nil {
		t.Fatalf("ReplyToContactMessage: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, leaving.User.ID); err != nil {
		t.Fatalf("delete the author's account: %v", err)
	}

	seen := env.getContactMessage(t, tenant, "CONTACTRPLM6")
	if len(seen.Entries) != 1 || seen.Entries[0].Body != "An answer." {
		t.Fatalf("entries = %+v, want the answer kept", seen.Entries)
	}
	if author := seen.Entries[0]; author.AuthorUserId != "" || author.AuthorPublicId != "" || author.AuthorName != "" {
		t.Errorf("author = (%q, %q, %q), want none once the account is gone", author.AuthorUserId, author.AuthorPublicId, author.AuthorName)
	}
}

// An answer goes to an address a reader typed into the public form, so the
// mail behind it is bounded like every other form that mails such an address,
// and an answer over the allowance stores nothing at all.
func TestDBReplyToContactMessageStopsAtTheMailLimit(t *testing.T) {
	env := newAdminDBEnvWithMailGuard(t, mailGuardWith(platformpolicy.HourDay{PerHour: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}))
	tenant := env.seedTenantWithAdmin(t, "CONTACTRPL7", "aoto7.example.test", "Aoto Press", "CONTACTRPLA7", "kei@aoto7.example.test")
	messageID := env.seedContactMessage(t, tenant, "CONTACTRPLM7", sql.NullString{})

	// A message that does not exist sends nothing, so it spends nothing either.
	if _, err := env.replyToContactMessage(tenant, uuid.Must(uuid.NewV7()).String(), "An answer."); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ReplyToContactMessage for no message = %v, want not_found", err)
	}
	if _, err := env.replyToContactMessage(tenant, messageID, "The first answer."); err != nil {
		t.Fatalf("the first ReplyToContactMessage: %v", err)
	}
	if _, err := env.replyToContactMessage(tenant, messageID, "A second answer."); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second ReplyToContactMessage = %v, want resource_exhausted", err)
	}

	if got := env.countRows(t, `SELECT count(*) FROM contact_message_entries WHERE contact_message_id = $1`, messageID); got != 1 {
		t.Errorf("stored entries = %d, want the one the allowance paid for", got)
	}
	if events := env.storedReplyEmailEvents(t, tenant); len(events) != 1 {
		t.Errorf("queued reply mails = %d, want the one the allowance paid for", len(events))
	}
}
