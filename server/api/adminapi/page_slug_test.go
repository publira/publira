package adminapi

import (
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/rpcerrors"
)

func TestNormalizePageSlugForStorage(t *testing.T) {
	tests := []struct {
		in         string
		want       string
		wantErr    bool
		wantReason string
	}{
		{in: "", want: ""},
		{in: "/", want: ""},
		{in: "privacy", want: "/privacy"},
		{in: "/privacy", want: "/privacy"},
		{in: "//privacy//", want: "/privacy"},
		{in: "  /legal/terms  ", want: "/legal/terms"},
		{in: "legal//terms", want: "/legal/terms"},
		{in: "Under_score", wantErr: true},
		// A page may share a path with one of the site's screens and is served
		// there instead of it.
		{in: "/series/", want: "/series"},
		{in: "/contact", want: "/contact"},
		{in: "/my", want: "/my"},
		{in: "/login", wantErr: true, wantReason: rpcerrors.FieldReasonPageSlugReserved},
		{in: "signup", wantErr: true, wantReason: rpcerrors.FieldReasonPageSlugReserved},
		{in: "/verify/token", wantErr: true, wantReason: rpcerrors.FieldReasonPageSlugReserved},
		{in: "/confirm-email", wantErr: true, wantReason: rpcerrors.FieldReasonPageSlugReserved},
		{in: "/confirm-password", wantErr: true, wantReason: rpcerrors.FieldReasonPageSlugReserved},
		{in: "/reset-password", wantErr: true, wantReason: rpcerrors.FieldReasonPageSlugReserved},
		{in: "/resend-verification", wantErr: true, wantReason: rpcerrors.FieldReasonPageSlugReserved},
		{in: "/settings/notifications", wantErr: true, wantReason: rpcerrors.FieldReasonPageSlugReserved},
		{in: "/help/login", want: "/help/login"},
	}
	for _, tt := range tests {
		got, err := normalizePageSlugForStorage(tt.in)
		if tt.wantErr {
			if err == nil {
				t.Fatalf("normalizePageSlugForStorage(%q) err = nil, want error", tt.in)
			}
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("normalizePageSlugForStorage(%q) code = %v, want %v", tt.in, connect.CodeOf(err), connect.CodeInvalidArgument)
			}
			assertBadRequestField(t, err, "slug")
			if reason := badRequestReason(t, err); reason != tt.wantReason {
				t.Fatalf("normalizePageSlugForStorage(%q) reason = %q, want %q", tt.in, reason, tt.wantReason)
			}
			continue
		}
		if err != nil {
			t.Fatalf("normalizePageSlugForStorage(%q) err = %v", tt.in, err)
		}
		if got != tt.want {
			t.Fatalf("normalizePageSlugForStorage(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func badRequestReason(t *testing.T, err error) string {
	t.Helper()
	detail, detailErr := err.(*connect.Error).Details()[0].Value()
	if detailErr != nil {
		t.Fatalf("detail = %v", detailErr)
	}
	return detail.(*errdetails.BadRequest).FieldViolations[0].Reason
}

func assertBadRequestField(t *testing.T, err error, wantField string) {
	t.Helper()
	rpcError, ok := err.(*connect.Error)
	if !ok {
		t.Fatalf("error type = %T, want *connect.Error", err)
	}
	if len(rpcError.Details()) != 1 {
		t.Fatalf("detail count = %d, want 1", len(rpcError.Details()))
	}
	detail, detailErr := rpcError.Details()[0].Value()
	if detailErr != nil {
		t.Fatalf("detail = %v", detailErr)
	}
	badRequest, ok := detail.(*errdetails.BadRequest)
	if !ok || len(badRequest.FieldViolations) != 1 || badRequest.FieldViolations[0].Field != wantField {
		t.Fatalf("field violations = %#v, want %q", badRequest, wantField)
	}
}
