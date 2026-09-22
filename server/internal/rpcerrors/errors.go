// Package rpcerrors attaches stable, typed details to Connect errors.
package rpcerrors

import (
	"errors"
	"math"
	"strconv"
	"time"

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
	ReasonCreatorRoleInUse        = "CREATOR_ROLE_IN_USE"
	ReasonInvitationCanceled      = "INVITATION_CANCELED"
	// ReasonLastTenantAdmin refuses removing or demoting the tenant's last
	// active tenant_admin.
	ReasonLastTenantAdmin        = "LAST_TENANT_ADMIN"
	ReasonMfaInvalidCode         = "MFA_INVALID_CODE"
	ReasonMfaLocked              = "MFA_LOCKED"
	ReasonSMTPTestAuthentication = "SMTP_TEST_AUTHENTICATION"
	ReasonSMTPTestConnection     = "SMTP_TEST_CONNECTION"
	ReasonSMTPTestRecipient      = "SMTP_TEST_RECIPIENT"
	ReasonSMTPTestStartTLS       = "SMTP_TEST_STARTTLS"
	ReasonSMTPTestTLS            = "SMTP_TEST_TLS"
	ReasonSMTPTestTimeout        = "SMTP_TEST_TIMEOUT"
	ReasonSMTPTestUnknown        = "SMTP_TEST_UNKNOWN"
	// ReasonStorageNotConfigured refuses an upload on a platform whose
	// operator has saved no object store yet.
	ReasonStorageNotConfigured = "STORAGE_NOT_CONFIGURED"
	// The object store refused one of the operations a connection test
	// performs. Each names what refused it rather than which operation it was:
	// the check carries the operation beside the reason.
	ReasonStorageTestBucketNotFound = "STORAGE_TEST_BUCKET_NOT_FOUND"
	ReasonStorageTestConnection     = "STORAGE_TEST_CONNECTION"
	ReasonStorageTestCredentials    = "STORAGE_TEST_CREDENTIALS"
	ReasonStorageTestObjectAltered  = "STORAGE_TEST_OBJECT_ALTERED"
	ReasonStorageTestObjectMissing  = "STORAGE_TEST_OBJECT_MISSING"
	ReasonStorageTestPermission     = "STORAGE_TEST_PERMISSION"
	ReasonStorageTestTimeout        = "STORAGE_TEST_TIMEOUT"
	ReasonStorageTestUnknown        = "STORAGE_TEST_UNKNOWN"

	// FieldReasonPageSlugReserved is a BadRequest field-violation reason, not
	// an ErrorInfo one: the page slug names a path the public site keeps for
	// its own screens.
	FieldReasonPageSlugReserved = "PAGE_SLUG_RESERVED"

	// MetadataCreditCount is the ErrorInfo metadata key for how many credits
	// still name a creator role that cannot be deleted. The value is a decimal
	// integer in decimal digits, with no sign or thousands separator.
	MetadataCreditCount = "credit_count"
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
// NewFieldViolationErrorWithReason is NewFieldViolationError with the
// violation's reason set, for a field that can be refused for more than one cause.
func NewFieldViolationErrorWithReason(code connect.Code, err error, field, reason string) *connect.Error {
	return withDetail(code, err, &errdetails.BadRequest{
		FieldViolations: []*errdetails.BadRequest_FieldViolation{{Field: field, Reason: reason}},
	})
}

func NewErrorInfoError(code connect.Code, err error, reason string) *connect.Error {
	return NewErrorInfoErrorWithMetadata(code, err, reason, nil)
}

// NewErrorInfoErrorWithMetadata is NewErrorInfoError with stringly-typed
// metadata the caller can read without parsing the English message.
func NewErrorInfoErrorWithMetadata(code connect.Code, err error, reason string, metadata map[string]string) *connect.Error {
	return withDetail(code, err, &errdetails.ErrorInfo{
		Domain:   ErrorInfoDomain,
		Reason:   reason,
		Metadata: metadata,
	})
}

// NewRateLimitedError is the one answer every exhausted allowance gives. It
// says how long the wait is and nothing about which rule ran out or what the
// caller asked for, so a caller cannot map the limits themselves from it, and
// two requests refused for different reasons are indistinguishable.
func NewRateLimitedError(retryAfter time.Duration) *connect.Error {
	err := connect.NewError(connect.CodeResourceExhausted, errors.New("too many requests, try again later"))
	if seconds := int(math.Ceil(retryAfter.Seconds())); seconds > 0 {
		err.Meta().Set("Retry-After", strconv.Itoa(seconds))
	}
	return err
}

func withDetail(code connect.Code, err error, message proto.Message) *connect.Error {
	rpcError := connect.NewError(code, err)
	detail, detailErr := connect.NewErrorDetail(message)
	if detailErr == nil {
		rpcError.AddDetail(detail)
	}
	return rpcError
}
