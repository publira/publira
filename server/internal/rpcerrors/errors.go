// Package rpcerrors attaches stable, typed details to Connect errors.
package rpcerrors

import (
	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/protobuf/proto"
)

const (
	// ErrorInfoDomain scopes ErrorInfo reasons emitted by Publira APIs.
	ErrorInfoDomain = "publira"

	ReasonArchiveInvalidEPUB      = "ARCHIVE_INVALID_EPUB"
	ReasonArchiveInvalidEPUBSpine = "ARCHIVE_INVALID_EPUB_SPINE"
	ReasonArchiveInvalidPath      = "ARCHIVE_INVALID_PATH"
	ReasonInvitationCanceled      = "INVITATION_CANCELED"
)

// NewFieldViolationError reports that one request field caused a rejected RPC.
// Field uses the protobuf request field name, rather than a localized label.
func NewFieldViolationError(code connect.Code, err error, field string) *connect.Error {
	return withDetail(code, err, &errdetails.BadRequest{
		FieldViolations: []*errdetails.BadRequest_FieldViolation{{Field: field}},
	})
}

// NewErrorInfoError reports a stable reason for a failure that is not tied to a
// single invalid request field.
func NewErrorInfoError(code connect.Code, err error, reason string) *connect.Error {
	return withDetail(code, err, &errdetails.ErrorInfo{
		Domain: ErrorInfoDomain,
		Reason: reason,
	})
}

func withDetail(code connect.Code, err error, message proto.Message) *connect.Error {
	rpcError := connect.NewError(code, err)
	detail, detailErr := connect.NewErrorDetail(message)
	if detailErr == nil {
		rpcError.AddDetail(detail)
	}
	return rpcError
}
