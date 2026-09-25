package tenantmembers

import (
	"context"
	crand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
)

// InvitationTTL is how long an invitation's link can be accepted, counted from
// its creation or its latest resend.
const InvitationTTL = 24 * time.Hour

var (
	ErrEmailRequired         = errors.New("email is required")
	ErrInvalidEmail          = errors.New("invalid email")
	ErrInvitationNotFound    = errors.New("invitation not found")
	ErrInvitationAccepted    = errors.New("invitation already accepted")
	ErrInvitationWasCanceled = errors.New("invitation already canceled")
	ErrInvalidInvitationID   = errors.New("invalid invitation_id")
)

// ParseInvitationID reads the ID an invitation is named by.
func ParseInvitationID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return uuid.Nil, invalid(FieldInvitationID, ErrInvalidInvitationID)
	}
	return id, nil
}

// Invitation statuses, as [InvitationStatus] reports them.
const (
	StatusPending  = "pending"
	StatusAccepted = "accepted"
	StatusCanceled = "canceled"
	StatusExpired  = "expired"
)

// InvitationStatus is where invitation stands at now.
func InvitationStatus(invitation dbmodels.TenantAdminInvitation, now time.Time) string {
	switch {
	case invitation.AcceptedAt.Valid:
		return StatusAccepted
	case invitation.CanceledAt.Valid:
		return StatusCanceled
	case !invitation.ExpiresAt.After(now):
		return StatusExpired
	default:
		return StatusPending
	}
}

// NormalizeEmail answers the address an invitation is keyed on.
func NormalizeEmail(raw string) (string, error) {
	email := strings.TrimSpace(strings.ToLower(raw))
	if email == "" {
		return "", ErrEmailRequired
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return "", ErrInvalidEmail
	}
	return email, nil
}

// ListInvitations reads one page of the tenant's invitations. A backward page
// comes back in ascending order, for [pagination.Page] to flip.
func ListInvitations(ctx context.Context, q dbmodels.Querier, p ListParams) ([]dbmodels.TenantAdminInvitation, error) {
	cursorID := uuid.NullUUID{UUID: p.Keys.ID, Valid: p.Keys.Valid}
	cursorCreatedAt := sql.NullTime{Time: p.Keys.Time, Valid: p.Keys.Valid}
	if p.Direction == pagination.Backward {
		return q.ListTenantAdminInvitationsAsc(ctx, dbmodels.ListTenantAdminInvitationsAscParams{
			TenantID:        p.TenantID,
			CursorID:        cursorID,
			CursorCreatedAt: cursorCreatedAt,
			CursorInclusive: p.Keys.Inclusive,
			Limit:           p.Limit,
		})
	}
	return q.ListTenantAdminInvitationsDesc(ctx, dbmodels.ListTenantAdminInvitationsDescParams{
		TenantID:        p.TenantID,
		CursorID:        cursorID,
		CursorCreatedAt: cursorCreatedAt,
		CursorInclusive: p.Keys.Inclusive,
		Limit:           p.Limit,
	})
}

// InviteParams makes Email a tenant_admin of the tenant.
type InviteParams struct {
	TenantID uuid.UUID
	Email    string
	// AllowMail, when set, is asked before anything is written for an address
	// that will be mailed, and its error is returned as is.
	AllowMail func(email string) error
}

// Invited is what [Invite] did: either it granted the role to a user the
// tenant already had, or it left Invitation pending with its mail queued.
type Invited struct {
	// Email is the normalized address, which is what audit entries name.
	Email                  string
	Invitation             dbmodels.TenantAdminInvitation
	RoleGrantedImmediately bool
}

// Validate refuses p without reading anything.
func (p InviteParams) Validate() error {
	_, err := normalizeEmail(p.Email)
	return err
}

// Invite makes the address a tenant_admin inside tx. An address that already
// belongs to a user of the tenant is granted the role on the spot; any other
// is sent an invitation, rearming the one it already has.
func Invite(ctx context.Context, tx *sql.Tx, p InviteParams) (Invited, error) {
	email, err := normalizeEmail(p.Email)
	if err != nil {
		return Invited{}, err
	}
	q := dbmodels.New(tx)

	user, err := q.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: p.TenantID, Valid: true},
		Email:    email,
	})
	switch {
	case err == nil:
		if err := ReplaceRole(ctx, q, p.TenantID, user.ID, auth.RoleTenantAdmin); err != nil {
			return Invited{}, err
		}
		return Invited{Email: email, RoleGrantedImmediately: true}, nil
	case !errors.Is(err, sql.ErrNoRows):
		return Invited{}, fmt.Errorf("get user by email for tenant: %w", err)
	}

	existing, err := q.GetTenantAdminInvitationByTenantAndEmail(ctx, dbmodels.GetTenantAdminInvitationByTenantAndEmailParams{TenantID: p.TenantID, Email: email})
	found := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Invited{}, fmt.Errorf("get tenant admin invitation: %w", err)
	}
	if err := allowMail(p.AllowMail, email); err != nil {
		return Invited{}, err
	}

	var invitation dbmodels.TenantAdminInvitation
	if found {
		invitation, err = rearm(ctx, q, p.TenantID, existing.Email)
	} else {
		invitation, err = IssueInvitation(ctx, q, p.TenantID, email)
	}
	if err != nil {
		return Invited{}, err
	}
	return Invited{Email: email, Invitation: invitation}, nil
}

// IssueInvitation creates a new invitation for an address that has neither an
// account nor an invitation in the tenant, and queues its mail on q.
func IssueInvitation(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, email string) (dbmodels.TenantAdminInvitation, error) {
	token, err := newToken()
	if err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	invitation, err := q.CreateTenantAdminInvitation(ctx, dbmodels.CreateTenantAdminInvitationParams{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  tenantID,
		Email:     email,
		TokenHash: auth.HashToken(token),
		ExpiresAt: time.Now().Add(InvitationTTL),
	})
	if err != nil {
		return dbmodels.TenantAdminInvitation{}, fmt.Errorf("create tenant admin invitation: %w", err)
	}
	if err := enqueueMail(ctx, q, tenantID, invitation, token); err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	return invitation, nil
}

// InvitationParams names one invitation of a tenant.
type InvitationParams struct {
	TenantID     uuid.UUID
	InvitationID uuid.UUID
}

// ResendParams names the invitation to mail again.
type ResendParams struct {
	TenantID     uuid.UUID
	InvitationID uuid.UUID
	// AllowMail is asked as [InviteParams.AllowMail] is.
	AllowMail func(email string) error
}

// Resend gives a pending or expired invitation a new link and a new expiry
// inside tx, and queues the mail again.
func Resend(ctx context.Context, tx *sql.Tx, p ResendParams) (dbmodels.TenantAdminInvitation, error) {
	q := dbmodels.New(tx)
	invitation, err := getInvitation(ctx, q, InvitationParams{TenantID: p.TenantID, InvitationID: p.InvitationID})
	if err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	if invitation.AcceptedAt.Valid {
		return dbmodels.TenantAdminInvitation{}, ErrInvitationAccepted
	}
	if invitation.CanceledAt.Valid {
		return dbmodels.TenantAdminInvitation{}, ErrInvitationWasCanceled
	}
	if err := allowMail(p.AllowMail, invitation.Email); err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	return rearm(ctx, q, p.TenantID, invitation.Email)
}

// Cancel withdraws an invitation that has not been accepted.
func Cancel(ctx context.Context, q dbmodels.Querier, p InvitationParams) (dbmodels.TenantAdminInvitation, error) {
	invitation, err := getInvitation(ctx, q, p)
	if err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	if invitation.AcceptedAt.Valid {
		return dbmodels.TenantAdminInvitation{}, ErrInvitationAccepted
	}
	canceled, err := q.CancelTenantAdminInvitation(ctx, dbmodels.CancelTenantAdminInvitationParams{
		TenantID: p.TenantID,
		ID:       invitation.ID,
	})
	if err != nil {
		return dbmodels.TenantAdminInvitation{}, fmt.Errorf("cancel tenant admin invitation: %w", err)
	}
	return canceled, nil
}

func allowMail(allow func(string) error, email string) error {
	if allow == nil {
		return nil
	}
	return allow(email)
}

func getInvitation(ctx context.Context, q dbmodels.Querier, p InvitationParams) (dbmodels.TenantAdminInvitation, error) {
	invitation, err := q.GetTenantAdminInvitationByIDForTenant(ctx, dbmodels.GetTenantAdminInvitationByIDForTenantParams{
		TenantID: p.TenantID,
		ID:       p.InvitationID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.TenantAdminInvitation{}, ErrInvitationNotFound
		}
		return dbmodels.TenantAdminInvitation{}, fmt.Errorf("get tenant admin invitation: %w", err)
	}
	return invitation, nil
}

func rearm(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, email string) (dbmodels.TenantAdminInvitation, error) {
	token, err := newToken()
	if err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	invitation, err := q.UpdateTenantAdminInvitationForResend(ctx, dbmodels.UpdateTenantAdminInvitationForResendParams{
		TenantID:  tenantID,
		Email:     email,
		TokenHash: auth.HashToken(token),
		ExpiresAt: time.Now().Add(InvitationTTL),
	})
	if err != nil {
		return dbmodels.TenantAdminInvitation{}, fmt.Errorf("resend tenant admin invitation: %w", err)
	}
	if err := enqueueMail(ctx, q, tenantID, invitation, token); err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	return invitation, nil
}

func newToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := crand.Read(raw); err != nil {
		return "", fmt.Errorf("generate invitation token: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

func enqueueMail(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, invitation dbmodels.TenantAdminInvitation, token string) error {
	payload, err := json.Marshal(outbox.TenantAdminInvitationPayload{
		TenantID:     tenantID.String(),
		InvitationID: invitation.ID.String(),
		Token:        token,
	})
	if err != nil {
		return fmt.Errorf("marshal tenant admin invitation email event: %w", err)
	}
	_, err = q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeTenantAdminInvitationEmail,
		Payload:        payload,
		IdempotencyKey: fmt.Sprintf("tenant_admin_invitation_email:%s:%s", invitation.ID, auth.HashToken(token)),
		AvailableAt:    time.Now().UTC(),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("enqueue tenant admin invitation email: %w", err)
	}
	return nil
}
