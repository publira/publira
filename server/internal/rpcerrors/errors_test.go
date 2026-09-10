package rpcerrors

import (
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
)

func TestNewFieldViolationError(t *testing.T) {
	err := NewFieldViolationError(connect.CodeInvalidArgument, errors.New("invalid slug"), "slug")
	if err.Code() != connect.CodeInvalidArgument {
		t.Fatalf("Code() = %v, want %v", err.Code(), connect.CodeInvalidArgument)
	}
	if len(err.Details()) != 1 {
		t.Fatalf("details = %d, want 1", len(err.Details()))
	}
	detail, detailErr := err.Details()[0].Value()
	if detailErr != nil {
		t.Fatalf("detail Value(): %v", detailErr)
	}
	badRequest, ok := detail.(*errdetails.BadRequest)
	if !ok {
		t.Fatalf("detail type = %T, want *errdetails.BadRequest", detail)
	}
	if len(badRequest.FieldViolations) != 1 || badRequest.FieldViolations[0].Field != "slug" {
		t.Fatalf("field violations = %#v, want slug", badRequest.FieldViolations)
	}
}

func TestNewErrorInfoError(t *testing.T) {
	err := NewErrorInfoError(connect.CodeFailedPrecondition, errors.New("invitation canceled"), ReasonInvitationCanceled)
	detail, detailErr := err.Details()[0].Value()
	if detailErr != nil {
		t.Fatalf("detail Value(): %v", detailErr)
	}
	info, ok := detail.(*errdetails.ErrorInfo)
	if !ok {
		t.Fatalf("detail type = %T, want *errdetails.ErrorInfo", detail)
	}
	if info.Domain != ErrorInfoDomain || info.Reason != ReasonInvitationCanceled {
		t.Fatalf("ErrorInfo = %#v, want domain %q and reason %q", info, ErrorInfoDomain, ReasonInvitationCanceled)
	}
}

func TestNewRateLimitedErrorSaysHowLongToWait(t *testing.T) {
	err := NewRateLimitedError(1500 * time.Millisecond)

	if err.Code() != connect.CodeResourceExhausted {
		t.Fatalf("Code() = %v, want %v", err.Code(), connect.CodeResourceExhausted)
	}
	// Rounded up, so a caller who waits exactly what they were told is past the
	// window rather than back inside it.
	if got := err.Meta().Get("Retry-After"); got != "2" {
		t.Fatalf("Retry-After = %q, want 2 seconds", got)
	}
}

// A refusal that has no window left to report says only that the caller is out
// of allowance, rather than telling them to come back in no time at all.
func TestNewRateLimitedErrorOmitsAnEmptyWait(t *testing.T) {
	err := NewRateLimitedError(0)

	if got := err.Meta().Get("Retry-After"); got != "" {
		t.Fatalf("Retry-After = %q, want it unset", got)
	}
}
