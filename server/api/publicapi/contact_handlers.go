package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
)

const (
	// The lengths the column checks enforce, applied here so a reader is told
	// which field is too long instead of meeting a constraint violation.
	//
	// The body is counted in Unicode code points rather than bytes, so the same
	// letter costs the same whatever script it is written in. The address is
	// counted in bytes because 254 is the length a mailbox may have.
	maxContactSubjectRunes = 200
	maxContactBodyRunes    = 4000
	maxContactReplyToBytes = 254
)

// contactMessage is one submission after the request has been checked, with the
// optional subject already reduced to what is stored: nothing at all.
type contactMessage struct {
	replyToEmail string
	subject      sql.NullString
	body         string
}

// validateContactMessage normalises what is stored and rejects what the columns
// should never hold. Trimming happens before every length check, so trailing
// whitespace cannot push a message over a limit, and a field of nothing but
// whitespace is as empty as one of nothing at all.
func validateContactMessage(msg *publirav1.SubmitContactMessageRequest) (contactMessage, error) {
	replyTo := strings.TrimSpace(msg.ReplyToEmail)
	if replyTo == "" {
		return contactMessage{}, contactFieldError("reply_to_email", errors.New("a reply-to address is required"))
	}
	if len(replyTo) > maxContactReplyToBytes {
		return contactMessage{}, contactFieldError("reply_to_email", fmt.Errorf("the address must be at most %d bytes", maxContactReplyToBytes))
	}
	// A bare mailbox and nothing else: net/mail also accepts `Name <a@b>`, and a
	// display name the reader typed into an address field would be shown to
	// staff as the address to answer at.
	parsed, err := mail.ParseAddress(replyTo)
	if err != nil || parsed.Address != replyTo {
		return contactMessage{}, contactFieldError("reply_to_email", errors.New("the address is not a valid email address"))
	}

	body := strings.TrimSpace(msg.Body)
	if body == "" {
		return contactMessage{}, contactFieldError("body", errors.New("a message is required"))
	}
	if utf8.RuneCountInString(body) > maxContactBodyRunes {
		return contactMessage{}, contactFieldError("body", fmt.Errorf("the message must be at most %d characters", maxContactBodyRunes))
	}

	subject := strings.TrimSpace(msg.Subject)
	if utf8.RuneCountInString(subject) > maxContactSubjectRunes {
		return contactMessage{}, contactFieldError("subject", fmt.Errorf("the subject must be at most %d characters", maxContactSubjectRunes))
	}

	return contactMessage{
		replyToEmail: replyTo,
		subject:      sql.NullString{String: subject, Valid: subject != ""},
		body:         body,
	}, nil
}

func contactFieldError(field string, err error) error {
	return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, field)
}

// storeContactMessage writes the message and, in the same transaction, the
// event that tells the tenant's staff it arrived. One transaction, so a message
// nobody is told about cannot outlive the request that stored it, and no mail
// can announce a message that was never written.
//
// Both IDs are generated here rather than by the caller. The public ID's
// collision is resolved by retrying the insert, and inside a transaction that
// retry has to roll back to a savepoint, which is what publicid.InsertTx does.
func (s *apiServer) storeContactMessage(
	ctx context.Context,
	params dbmodels.CreateContactMessageParams,
) (dbmodels.ContactMessage, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return dbmodels.ContactMessage{}, fmt.Errorf("generate contact message id: %w", err)
	}
	params.ID = id

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return dbmodels.ContactMessage{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	message, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.ContactMessage, error) {
		params.PublicID = publicID
		return txq.CreateContactMessage(ctx, params)
	})
	if err != nil {
		return dbmodels.ContactMessage{}, err
	}
	payload, err := json.Marshal(outbox.ContactMessageStaffEmailPayload{
		TenantID:  params.TenantID.String(),
		MessageID: message.ID.String(),
	})
	if err != nil {
		return dbmodels.ContactMessage{}, fmt.Errorf("marshal contact message staff email event: %w", err)
	}
	if err := insertPublicOutboxEvent(
		ctx, txq, params.TenantID, outbox.EventTypeContactMessageStaffEmail, payload,
		outbox.ContactMessageStaffEmailIdempotencyKey(message.ID),
	); err != nil {
		return dbmodels.ContactMessage{}, err
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.ContactMessage{}, err
	}
	return message, nil
}

// SubmitContactMessage stores one message for the tenant's staff.
//
// A session is optional. A reader who cannot sign in is one of the people who
// needs to reach the tenant, so a guest may write; a reader who is signed in
// has their account attached, which is what lets staff tell a question about an
// account from one about the site.
func (s *apiServer) SubmitContactMessage(
	ctx context.Context,
	req *connect.Request[publirav1.SubmitContactMessageRequest],
) (*connect.Response[publirav1.SubmitContactMessageResponse], error) {
	tenant, reader, err := s.optionalReaderFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	message, err := validateContactMessage(req.Msg)
	if err != nil {
		return nil, err
	}

	// The client's allowance is charged whoever is asking, because it is the only
	// one a sender signed in to nothing spends. The account's goes on top of it
	// rather than instead of it, so signing up does not widen what one client may
	// send.
	if err := s.chargeClientAction(ctx, actionSubmitContactMessageFromClient, req); err != nil {
		return nil, err
	}
	if reader.Valid {
		if err := s.chargeReaderAction(ctx, actionSubmitContactMessage, tenant.ID, reader.UUID); err != nil {
			return nil, err
		}
	}

	if _, err := s.storeContactMessage(ctx, dbmodels.CreateContactMessageParams{
		TenantID:     tenant.ID,
		UserID:       reader,
		ReplyToEmail: message.replyToEmail,
		Subject:      message.subject,
		Body:         message.body,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to store the contact message", err, "tenant_id", tenant.ID.String())
	}

	return noStorePrivateResponse(&publirav1.SubmitContactMessageResponse{}), nil
}
