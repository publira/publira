package publicapi

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Who owns a contact message and the note staff keep on it are the console's
// alone: they are written through AdminContactService and read back through
// it, and the reader who wrote the message never sees either.

func (c adminContactConsole) assign(messageID, assigneeUserID string) (*publiraadminv1.ContactMessage, error) {
	res, err := c.client.AssignContactMessage(context.Background(), newBearerRequest(&publiraadminv1.AssignContactMessageRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: c.tenant.ID.String()},
		ContactMessageId: messageID,
		AssigneeUserId:   assigneeUserID,
	}, c.token))
	if err != nil {
		return nil, err
	}
	return res.Msg.Message, nil
}

func (c adminContactConsole) updateStaffNote(messageID, note string) (*publiraadminv1.ContactMessage, error) {
	res, err := c.client.UpdateContactMessageStaffNote(context.Background(), newBearerRequest(&publiraadminv1.UpdateContactMessageStaffNoteRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: c.tenant.ID.String()},
		ContactMessageId: messageID,
		StaffNote:        note,
	}, c.token))
	if err != nil {
		return nil, err
	}
	return res.Msg.Message, nil
}

func (c adminContactConsole) markHandled(t *testing.T, messageID string, handled bool) *publiraadminv1.ContactMessage {
	t.Helper()

	res, err := c.client.MarkContactMessageHandled(context.Background(), newBearerRequest(&publiraadminv1.MarkContactMessageHandledRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: c.tenant.ID.String()},
		ContactMessageId: messageID,
		Handled:          handled,
	}, c.token))
	if err != nil {
		t.Fatalf("MarkContactMessageHandled(%t): %v", handled, err)
	}
	return res.Msg.Message
}

// seedGuestContactMessage sends one message as a guest and returns it as the
// inbox lists it.
func (e *publicDBEnv) seedGuestContactMessage(t *testing.T, tenant testutil.Tenant, console adminContactConsole) *publiraadminv1.ContactMessage {
	t.Helper()

	if err := e.submitContactMessage(t, tenant, &publirav1.SubmitContactMessageRequest{
		ReplyToEmail: "guest@example.test",
		Body:         "A question.",
	}); err != nil {
		t.Fatalf("SubmitContactMessage: %v", err)
	}
	return console.list(t, "", 20, "").Messages[0]
}

func (e *publicDBEnv) storedContactMessageAssignee(t *testing.T, messageID string) uuid.NullUUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var assignee uuid.NullUUID
	if err := e.PG.DB.QueryRowContext(ctx, `SELECT assigned_to FROM contact_messages WHERE id = $1`, messageID).Scan(&assignee); err != nil {
		t.Fatalf("read assigned_to: %v", err)
	}
	return assignee
}

func assertContactMessageAssignee(t *testing.T, message *publiraadminv1.ContactMessage, want testutil.TenantUser) {
	t.Helper()

	if message.AssigneeUserId != want.ID.String() || message.AssigneePublicId != want.PublicID || message.AssigneeName != want.Name {
		t.Errorf("assignee = (%q, %q, %q), want (%q, %q, %q)",
			message.AssigneeUserId, message.AssigneePublicId, message.AssigneeName,
			want.ID.String(), want.PublicID, want.Name)
	}
}

func assertContactMessageUnassigned(t *testing.T, message *publiraadminv1.ContactMessage) {
	t.Helper()

	if message.AssigneeUserId != "" || message.AssigneePublicId != "" || message.AssigneeName != "" {
		t.Errorf("assignee = (%q, %q, %q), want none", message.AssigneeUserId, message.AssigneePublicId, message.AssigneeName)
	}
}

func TestDBContactMessageIsAssignedReassignedAndCleared(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT9", "contact9.example.com", "Aoto Press")
	first := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF9A", "first@contact9.example.com", "Kei Arata")
	second := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF9B", "second@contact9.example.com", "Mio Sato")

	console := env.openAdminContactConsole(t, tenant, first)
	message := env.seedGuestContactMessage(t, tenant, console)
	assertContactMessageUnassigned(t, message)

	assigned, err := console.assign(message.Id, first.ID.String())
	if err != nil {
		t.Fatalf("AssignContactMessage to the caller: %v", err)
	}
	assertContactMessageAssignee(t, assigned, first)

	reassigned, err := console.assign(message.Id, second.ID.String())
	if err != nil {
		t.Fatalf("AssignContactMessage to another member of staff: %v", err)
	}
	assertContactMessageAssignee(t, reassigned, second)

	// The list and the single read carry the assignee as the answer did.
	assertContactMessageAssignee(t, console.list(t, "", 20, "").Messages[0], second)
	got, err := console.client.GetContactMessage(context.Background(), newBearerRequest(&publiraadminv1.GetContactMessageRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: message.PublicId,
	}, console.token))
	if err != nil {
		t.Fatalf("GetContactMessage: %v", err)
	}
	assertContactMessageAssignee(t, got.Msg.Message, second)

	// Handling and reopening are the handled flag's business and leave the
	// assignee where it is, though somebody else did the handling.
	assertContactMessageAssignee(t, console.markHandled(t, message.Id, true), second)
	assertContactMessageAssignee(t, console.markHandled(t, message.Id, false), second)

	cleared, err := console.assign(message.Id, "")
	if err != nil {
		t.Fatalf("AssignContactMessage to nobody: %v", err)
	}
	assertContactMessageUnassigned(t, cleared)
	if stored := env.storedContactMessageAssignee(t, message.Id); stored.Valid {
		t.Errorf("assigned_to = %s after the assignment was cleared", stored.UUID)
	}

	// Clearing what is already clear is the same statement made again.
	if _, err := console.assign(message.Id, ""); err != nil {
		t.Fatalf("AssignContactMessage to nobody twice: %v", err)
	}
}

// Only an account that can open the inbox can be handed a message from it.
func TestDBContactMessageRefusesAnAssigneeWhoCannotWorkTheInbox(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF10", "staff@tenant-a.example.com", "Staff")
	reader := env.PG.SeedEndUser(t, tenant.ID, "CONTACTRDR10", "reader@tenant-a.example.com", "Rin Amagai")
	editor := env.PG.SeedTenantUser(t, tenant.ID, "CONTACTEDT10", "editor@tenant-a.example.com", "Editor", auth.RoleTenantEditor)
	suspended := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSUS10", "suspended@tenant-a.example.com", "Suspended")
	otherAdmin := env.PG.SeedTenantAdmin(t, otherTenant.ID, "CONTACTOTH10", "staff@tenant-b.example.com", "Other Staff")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE users SET status = 'suspended' WHERE id = $1`, suspended.ID); err != nil {
		t.Fatalf("suspend the account: %v", err)
	}

	console := env.openAdminContactConsole(t, tenant, staff)
	message := env.seedGuestContactMessage(t, tenant, console)

	for _, testCase := range []struct {
		name     string
		assignee string
	}{
		{name: "a reader", assignee: reader.ID.String()},
		{name: "an editor, who cannot open the inbox", assignee: editor.ID.String()},
		{name: "a suspended tenant_admin", assignee: suspended.ID.String()},
		{name: "another tenant's tenant_admin", assignee: otherAdmin.ID.String()},
		{name: "an account that does not exist", assignee: uuid.Must(uuid.NewV7()).String()},
		{name: "a public ID in place of the user ID", assignee: staff.PublicID},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := console.assign(message.Id, testCase.assignee)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("AssignContactMessage = %v, want invalid_argument", err)
			}
		})
	}

	if stored := env.storedContactMessageAssignee(t, message.Id); stored.Valid {
		t.Errorf("a refused assignment stored assigned_to = %s", stored.UUID)
	}
}

// The assignee's account going away leaves the message where it was, waiting
// for somebody else.
func TestDBContactMessageOutlivesItsAssigneesAccount(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT11", "contact11.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF11", "staff@contact11.example.com", "Staff")
	leaving := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTLVG11", "leaving@contact11.example.com", "Leaving")

	console := env.openAdminContactConsole(t, tenant, staff)
	message := env.seedGuestContactMessage(t, tenant, console)
	if _, err := console.assign(message.Id, leaving.ID.String()); err != nil {
		t.Fatalf("AssignContactMessage: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, leaving.ID); err != nil {
		t.Fatalf("delete the assignee's account: %v", err)
	}

	listed := console.list(t, "", 20, "").Messages
	if len(listed) != 1 || listed[0].Id != message.Id {
		t.Fatalf("the inbox lists %d messages after the assignee's account was deleted, want the one", len(listed))
	}
	assertContactMessageUnassigned(t, listed[0])
	if stored := env.storedContactMessageAssignee(t, message.Id); stored.Valid {
		t.Errorf("assigned_to = %s names a deleted account", stored.UUID)
	}
}

func TestDBContactMessageStaffNoteIsSavedEditedAndCleared(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT12", "contact12.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF12", "staff@contact12.example.com", "Staff")

	console := env.openAdminContactConsole(t, tenant, staff)
	message := env.seedGuestContactMessage(t, tenant, console)
	if message.StaffNote != "" {
		t.Fatalf("a new message carries staff_note = %q", message.StaffNote)
	}

	saved, err := console.updateStaffNote(message.Id, "  Asked the reader for their device.  ")
	if err != nil {
		t.Fatalf("UpdateContactMessageStaffNote: %v", err)
	}
	if saved.StaffNote != "Asked the reader for their device." {
		t.Errorf("staff_note = %q, want the note trimmed", saved.StaffNote)
	}

	edited, err := console.updateStaffNote(message.Id, "The reader uses an old tablet.")
	if err != nil {
		t.Fatalf("UpdateContactMessageStaffNote to edit: %v", err)
	}
	if edited.StaffNote != "The reader uses an old tablet." {
		t.Errorf("staff_note = %q after an edit", edited.StaffNote)
	}
	if listed := console.list(t, "", 20, "").Messages[0]; listed.StaffNote != edited.StaffNote {
		t.Errorf("the list carries staff_note = %q, want %q", listed.StaffNote, edited.StaffNote)
	}

	// The limit counts characters, so a note in any script may be as long.
	longest := strings.Repeat("あ", 4000)
	if _, err := console.updateStaffNote(message.Id, longest); err != nil {
		t.Fatalf("UpdateContactMessageStaffNote at the limit: %v", err)
	}
	if _, err := console.updateStaffNote(message.Id, longest+"あ"); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateContactMessageStaffNote past the limit = %v, want invalid_argument", err)
	}

	cleared, err := console.updateStaffNote(message.Id, "   ")
	if err != nil {
		t.Fatalf("UpdateContactMessageStaffNote to clear: %v", err)
	}
	if cleared.StaffNote != "" {
		t.Errorf("staff_note = %q after it was cleared", cleared.StaffNote)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var stored sql.NullString
	if err := env.PG.DB.QueryRowContext(ctx, `SELECT staff_note FROM contact_messages WHERE id = $1`, message.Id).Scan(&stored); err != nil {
		t.Fatalf("read staff_note: %v", err)
	}
	if stored.Valid {
		t.Errorf("a cleared note is stored as %q rather than NULL", stored.String)
	}
}

// The inbox is a tenant_admin's, and so are the two things staff write on a
// message in it.
func TestDBContactMessageStaffFieldsRequireATenantAdmin(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT13", "contact13.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF13", "staff@contact13.example.com", "Staff")
	editor := env.PG.SeedTenantUser(t, tenant.ID, "CONTACTEDT13", "editor@contact13.example.com", "Editor", auth.RoleTenantEditor)

	message := env.seedGuestContactMessage(t, tenant, env.openAdminContactConsole(t, tenant, staff))
	asEditor := env.openAdminContactConsole(t, tenant, editor)

	if _, err := asEditor.assign(message.Id, editor.ID.String()); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("AssignContactMessage as an editor = %v, want permission_denied", err)
	}
	if _, err := asEditor.updateStaffNote(message.Id, "A note."); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("UpdateContactMessageStaffNote as an editor = %v, want permission_denied", err)
	}
}

func TestDBContactMessageStaffFieldsStayOnTheirOwnTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	firstStaff := env.PG.SeedTenantAdmin(t, first.ID, "CONTACTSTFA", "staff@tenant-a.example.com", "Staff A")
	secondStaff := env.PG.SeedTenantAdmin(t, second.ID, "CONTACTSTFB", "staff@tenant-b.example.com", "Staff B")

	message := env.seedGuestContactMessage(t, first, env.openAdminContactConsole(t, first, firstStaff))
	other := env.openAdminContactConsole(t, second, secondStaff)

	if _, err := other.assign(message.Id, secondStaff.ID.String()); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("AssignContactMessage across tenants = %v, want not_found", err)
	}
	if _, err := other.updateStaffNote(message.Id, "A note."); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("UpdateContactMessageStaffNote across tenants = %v, want not_found", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var assignee uuid.NullUUID
	var note sql.NullString
	if err := env.PG.DB.QueryRowContext(ctx, `SELECT assigned_to, staff_note FROM contact_messages WHERE id = $1`, message.Id).Scan(&assignee, &note); err != nil {
		t.Fatalf("read the message: %v", err)
	}
	if assignee.Valid || note.Valid {
		t.Errorf("another tenant wrote assigned_to = %v, staff_note = %v", assignee, note)
	}
}

// The public API is where a reader reads what the tenant holds about them, so
// no message in it may carry the note staff keep. The contact form answers with
// nothing today; this is what keeps a later field from carrying the note.
func TestPublicAPICarriesNoStaffNote(t *testing.T) {
	var carrying []string
	protoregistry.GlobalFiles.RangeFilesByPackage("publira.v1", func(file protoreflect.FileDescriptor) bool {
		messages := file.Messages()
		for i := range messages.Len() {
			collectStaffNoteFields(messages.Get(i), &carrying)
		}
		return true
	})
	if len(carrying) > 0 {
		t.Errorf("public API messages carry a staff note: %v", carrying)
	}
}

func collectStaffNoteFields(message protoreflect.MessageDescriptor, carrying *[]string) {
	fields := message.Fields()
	for i := range fields.Len() {
		if field := fields.Get(i); strings.Contains(string(field.Name()), "staff_note") {
			*carrying = append(*carrying, string(field.FullName()))
		}
	}
	nested := message.Messages()
	for i := range nested.Len() {
		collectStaffNoteFields(nested.Get(i), carrying)
	}
}

var contactMessageStatuses = []string{"unhandled", "in_progress", "handled"}

// assertContactMessageStatus checks where a message stands from every side the
// console reads it: the answer an action returned, the single read, and the
// inbox, where it lists under its own status's filter and under no other.
func (c adminContactConsole) assertContactMessageStatus(t *testing.T, answer *publiraadminv1.ContactMessage, want string) {
	t.Helper()

	if answer.Status != want {
		t.Errorf("the answer carries status = %q, want %q", answer.Status, want)
	}
	got, err := c.client.GetContactMessage(context.Background(), newBearerRequest(&publiraadminv1.GetContactMessageRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: c.tenant.ID.String()},
		PublicId: answer.PublicId,
	}, c.token))
	if err != nil {
		t.Fatalf("GetContactMessage: %v", err)
	}
	if got.Msg.Message.Status != want {
		t.Errorf("GetContactMessage carries status = %q, want %q", got.Msg.Message.Status, want)
	}

	for _, filter := range append([]string{""}, contactMessageStatuses...) {
		var listed *publiraadminv1.ContactMessage
		for _, message := range c.list(t, filter, 100, "").Messages {
			if message.Id == answer.Id {
				listed = message
			}
			if filter != "" && message.Status != filter {
				t.Errorf("ListContactMessages(%q) lists %s with status = %q", filter, message.PublicId, message.Status)
			}
		}
		switch {
		case filter == "" || filter == want:
			if listed == nil {
				t.Errorf("ListContactMessages(%q) leaves out a message whose status is %q", filter, want)
			} else if listed.Status != want {
				t.Errorf("ListContactMessages(%q) carries status = %q, want %q", filter, listed.Status, want)
			}
		case listed != nil:
			t.Errorf("ListContactMessages(%q) lists a message whose status is %q", filter, want)
		}
	}
}

func (e *publicDBEnv) storedContactMessageHandler(t *testing.T, messageID string) uuid.NullUUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var handler uuid.NullUUID
	if err := e.PG.DB.QueryRowContext(ctx, `SELECT handled_by FROM contact_messages WHERE id = $1`, messageID).Scan(&handler); err != nil {
		t.Fatalf("read handled_by: %v", err)
	}
	return handler
}

// The status is derived from the handled flag and the assignee together, so
// every way either one changes moves the message between the three filters.
func TestDBContactMessageStatusFollowsHandlingAndAssignment(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT14", "contact14.example.com", "Aoto Press")
	first := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTST14A", "first@contact14.example.com", "Kei Arata")
	second := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTST14B", "second@contact14.example.com", "Mio Sato")

	console := env.openAdminContactConsole(t, tenant, first)
	message := env.seedGuestContactMessage(t, tenant, console)
	console.assertContactMessageStatus(t, message, "unhandled")

	assigned, err := console.assign(message.Id, first.ID.String())
	if err != nil {
		t.Fatalf("AssignContactMessage: %v", err)
	}
	console.assertContactMessageStatus(t, assigned, "in_progress")

	reassigned, err := console.assign(message.Id, second.ID.String())
	if err != nil {
		t.Fatalf("AssignContactMessage to another member of staff: %v", err)
	}
	console.assertContactMessageStatus(t, reassigned, "in_progress")

	// The first member of staff completes a message the second one owns: the
	// row records each of them in its own column.
	handled := console.markHandled(t, message.Id, true)
	console.assertContactMessageStatus(t, handled, "handled")
	assertContactMessageAssignee(t, handled, second)
	if stored := env.storedContactMessageHandler(t, message.Id); stored.UUID != first.ID {
		t.Errorf("handled_by = %v, want the member of staff who marked it, %s", stored, first.ID)
	}
	if stored := env.storedContactMessageAssignee(t, message.Id); stored.UUID != second.ID {
		t.Errorf("assigned_to = %v after the message was handled, want %s", stored, second.ID)
	}

	// Reopening keeps the assignee, so the message is somebody's work again
	// rather than back in the untouched queue.
	reopened := console.markHandled(t, message.Id, false)
	console.assertContactMessageStatus(t, reopened, "in_progress")
	assertContactMessageAssignee(t, reopened, second)

	cleared, err := console.assign(message.Id, "")
	if err != nil {
		t.Fatalf("AssignContactMessage to nobody: %v", err)
	}
	console.assertContactMessageStatus(t, cleared, "unhandled")

	// A message nobody owns is handled all the same, and reopening it with
	// nobody assigned puts it back in the untouched queue.
	console.assertContactMessageStatus(t, console.markHandled(t, message.Id, true), "handled")
	console.assertContactMessageStatus(t, console.markHandled(t, message.Id, false), "unhandled")

	// Assigning a handled message leaves it handled.
	console.markHandled(t, message.Id, true)
	assignedAfterHandling, err := console.assign(message.Id, first.ID.String())
	if err != nil {
		t.Fatalf("AssignContactMessage on a handled message: %v", err)
	}
	console.assertContactMessageStatus(t, assignedAfterHandling, "handled")
}

// The two halves of the queue page apart: a page of one filter is filled with
// that filter's messages, not cut short by the other half's.
func TestDBContactMessageStatusFiltersPageIndependently(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT15", "contact15.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF15", "staff@contact15.example.com", "Staff")
	console := env.openAdminContactConsole(t, tenant, staff)

	// Six messages: the newest is handled, and behind it assigned ones
	// alternate with untouched ones, so neither half of the queue is a run the
	// other could hide behind a page boundary.
	for range 6 {
		env.seedGuestContactMessage(t, tenant, console)
	}
	all := console.list(t, "", 20, "").Messages
	if len(all) != 6 {
		t.Fatalf("the inbox lists %d messages, want 6", len(all))
	}
	want := map[string][]string{}
	for i, message := range all {
		switch {
		case i == 0:
			console.markHandled(t, message.Id, true)
			want["handled"] = append(want["handled"], message.Id)
		case i%2 == 1:
			if _, err := console.assign(message.Id, staff.ID.String()); err != nil {
				t.Fatalf("AssignContactMessage: %v", err)
			}
			want["in_progress"] = append(want["in_progress"], message.Id)
		default:
			want["unhandled"] = append(want["unhandled"], message.Id)
		}
	}

	for _, status := range contactMessageStatuses {
		var got []string
		token := ""
		for {
			page := console.list(t, status, 1, token)
			for _, message := range page.Messages {
				got = append(got, message.Id)
			}
			if page.NextToken == "" {
				break
			}
			token = page.NextToken
		}
		if strings.Join(got, ",") != strings.Join(want[status], ",") {
			t.Errorf("paging ListContactMessages(%q) one at a time = %v, want %v", status, got, want[status])
		}
	}
}

func TestDBContactMessageStatusFilterRefusesAnUnknownState(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "CONTACT16", "contact16.example.com", "Aoto Press")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "CONTACTSTF16", "staff@contact16.example.com", "Staff")
	console := env.openAdminContactConsole(t, tenant, staff)

	_, err := console.client.ListContactMessages(context.Background(), newBearerRequest(&publiraadminv1.ListContactMessagesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		Status: "assigned",
	}, console.token))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListContactMessages(%q) = %v, want invalid_argument", "assigned", err)
	}
}
