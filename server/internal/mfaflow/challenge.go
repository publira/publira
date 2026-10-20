package mfaflow

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
)

// Challenge is what a challenge token a correct password earned names. ID and
// ExpiresAt are what a single exchange of it is recorded under.
type Challenge struct {
	Subject            string
	TenantID           string
	CredentialsVersion int32
	ID                 uuid.UUID
	ExpiresAt          time.Time
}

// ParseChallenge verifies token for audience. ok is false for any token the
// caller has to refuse as an invalid session, one without a usable `jti` or
// expiry included: a token that cannot be recorded cannot be limited to one
// exchange.
//
// What the token names still has to be checked against the account it names:
// that it is active, and still holds the credentials version the token was
// signed with, so a suspension or a password change ends a pending challenge.
func ParseChallenge(tokens *auth.TokenManager, token, audience string) (challenge Challenge, ok bool) {
	if tokens == nil {
		return Challenge{}, false
	}
	claims, err := tokens.Verify(strings.TrimSpace(token), audience)
	if err != nil {
		return Challenge{}, false
	}
	id, err := uuid.Parse(strings.TrimSpace(claims.ID))
	if err != nil {
		return Challenge{}, false
	}
	if claims.ExpiresAt == nil {
		return Challenge{}, false
	}
	return Challenge{
		Subject:            claims.Subject,
		TenantID:           claims.TenantID,
		CredentialsVersion: claims.CredentialsVersion,
		ID:                 id,
		ExpiresAt:          claims.ExpiresAt.Time,
	}, true
}

// Owed is what a correct password still leaves owed.
type Owed int

const (
	// OwedNothing is a sign-in that finishes on the password alone.
	OwedNothing Owed = iota
	// OwedVerification is an answer from a factor the account holds.
	OwedVerification
	// OwedEnrollment is a factor the account has to enroll first.
	OwedEnrollment
)

// OwedAfterPassword decides what a correct password still leaves owed. An
// account holding a second factor owes an answer from one of them; one
// without owes an enrollment only where required says the factor is a
// condition of signing in. The factors come back with the answer, for a
// challenge that lists them. An error from required is returned as it is.
func OwedAfterPassword(ctx context.Context, acct Account, required func(context.Context) (bool, error)) (Owed, Factors, error) {
	factors, err := FactorsOf(ctx, acct, acct.Queries(ctx))
	if err != nil {
		return OwedNothing, Factors{}, err
	}
	if factors.Any() {
		return OwedVerification, factors, nil
	}
	mustEnroll, err := required(ctx)
	if err != nil {
		return OwedNothing, Factors{}, err
	}
	if mustEnroll {
		return OwedEnrollment, factors, nil
	}
	return OwedNothing, factors, nil
}
