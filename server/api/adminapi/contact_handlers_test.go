package adminapi

import (
	"database/sql"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

func TestContactMessageStatusDerivesFromHandledAtAndTheAssignee(t *testing.T) {
	handledAt := sql.NullTime{Time: time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC), Valid: true}
	assignee := uuid.NullUUID{UUID: uuid.Must(uuid.NewV7()), Valid: true}
	handler := uuid.NullUUID{UUID: uuid.Must(uuid.NewV7()), Valid: true}

	for _, testCase := range []struct {
		name string
		row  contactMessageRow
		want string
	}{
		{name: "neither handled nor assigned", row: contactMessageRow{}, want: "unhandled"},
		{name: "assigned and not handled", row: contactMessageRow{AssignedTo: assignee}, want: "in_progress"},
		{name: "handled with nobody assigned", row: contactMessageRow{HandledAt: handledAt, HandledBy: handler}, want: "handled"},
		// The assignee stays on a handled message, and it does not hold the
		// message back from being handled.
		{name: "handled and still assigned", row: contactMessageRow{HandledAt: handledAt, HandledBy: handler, AssignedTo: assignee}, want: "handled"},
		// handled_by is who completed the message, not who owns it, so it
		// alone does not put a waiting message in progress.
		{name: "handled_by without handled_at", row: contactMessageRow{HandledBy: handler}, want: "unhandled"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := contactMessageStatus(testCase.row); got != testCase.want {
				t.Errorf("contactMessageStatus = %q, want %q", got, testCase.want)
			}
			if got := contactMessageToProto(testCase.row).Status; got != testCase.want {
				t.Errorf("ContactMessage.status = %q, want %q", got, testCase.want)
			}
		})
	}
}

// Every state a message can be in is a filter the inbox accepts, so no message
// is left without a list that answers for it.
func TestNormalizeContactMessageStatusFilterAcceptsEveryDerivedState(t *testing.T) {
	for _, testCase := range []struct {
		in        string
		want      sql.NullString
		wantError bool
	}{
		{in: "", want: sql.NullString{}},
		{in: "  ", want: sql.NullString{}},
		{in: "unhandled", want: sql.NullString{String: "unhandled", Valid: true}},
		{in: "in_progress", want: sql.NullString{String: "in_progress", Valid: true}},
		{in: " handled ", want: sql.NullString{String: "handled", Valid: true}},
		{in: "in-progress", wantError: true},
		{in: "IN_PROGRESS", wantError: true},
		{in: "assigned", wantError: true},
	} {
		t.Run(testCase.in, func(t *testing.T) {
			got, err := normalizeContactMessageStatusFilter(testCase.in)
			if testCase.wantError {
				if connect.CodeOf(err) != connect.CodeInvalidArgument {
					t.Fatalf("normalizeContactMessageStatusFilter(%q) = %v, want invalid_argument", testCase.in, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeContactMessageStatusFilter(%q): %v", testCase.in, err)
			}
			if got != testCase.want {
				t.Errorf("normalizeContactMessageStatusFilter(%q) = %+v, want %+v", testCase.in, got, testCase.want)
			}
		})
	}
}
