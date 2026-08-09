// Package publicid generates and validates `public_id`, the identifier records
// are addressed by in URLs and API payloads.
//
// A public ID is 12 standard Base58 characters drawn from crypto/rand: about
// 70.3 bits of entropy in the same character varying(12) column the previous
// UUID-prefix format filled with 48 bits. Base58 leaves out 0, O, I and l, so a
// public ID is also distinguishable at a glance from the hexadecimal UUIDs used
// for primary keys. Values are case-sensitive; store and look them up by exact
// match.
package publicid

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/publira/publira/server/internal/dberr"
)

const (
	// Alphabet is the standard (Bitcoin) Base58 alphabet. Its characters are in
	// ascending byte order, so fixed-width encodings sort like their values.
	Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

	// Length is the number of Base58 characters in a public ID. It has to stay
	// within the character varying(12) columns declared in db/migrations.
	Length = 12

	// MaxAttempts is how many public IDs a single insert may burn on collisions
	// before it gives up.
	MaxAttempts = 3

	// constraintSuffix ends the name of every public_id unique constraint in
	// db/migrations, including the composite access_tickets_tenant_public_id_key.
	constraintSuffix = "_public_id_key"

	// savepointName scopes one [InsertTx] attempt. Reusing the name is fine:
	// a second SAVEPOINT with the same name shadows the first.
	savepointName = "publira_public_id"
)

// ErrAttemptsExhausted is returned when every attempt collided with an existing
// public ID. At 70 bits of entropy this means the random source is broken, not
// that the ID space is full.
//
// The collision that caused it is kept as text, not as a wrapped error: callers
// react to a unique violation by reporting the conflicting field to the client
// ("email already exists"), and an unwrappable *pgconn.PgError here would turn
// an internal failure into that answer.
var ErrAttemptsExhausted = errors.New("publicid: no unique public_id within the attempt budget")

// space is the number of distinct public IDs, 58^12.
var space = new(big.Int).Exp(big.NewInt(int64(len(Alphabet))), big.NewInt(Length), nil)

// Execer runs the savepoint statements [InsertTx] needs. *sql.Tx satisfies it.
type Execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// New returns a freshly generated public ID.
func New() (string, error) {
	value, err := rand.Int(rand.Reader, space)
	if err != nil {
		return "", fmt.Errorf("publicid: read random source: %w", err)
	}

	return encode(value), nil
}

// Valid reports whether s has the shape of a public ID. It says nothing about
// whether a record carries that value.
func Valid(s string) bool {
	if len(s) != Length {
		return false
	}
	for i := range len(s) {
		if strings.IndexByte(Alphabet, s[i]) < 0 {
			return false
		}
	}

	return true
}

// IsCollision reports whether err is a unique violation on a public_id
// constraint — the only conflict a regenerated ID can resolve. Conflicts on
// email, domain or idx_access_tickets_active_user_episode do not match, so they
// keep reaching the caller's own handling instead of being retried away.
func IsCollision(err error) bool {
	return strings.HasSuffix(dberr.UniqueViolationConstraint(err), constraintSuffix)
}

// Insert calls insert with a freshly generated public ID, retrying with a new
// one while insert reports a public_id collision. Every other error is returned
// as-is so callers keep their own handling for it.
//
// Use [InsertTx] when the insert runs inside an open transaction.
func Insert[T any](insert func(publicID string) (T, error)) (T, error) {
	var zero T

	var lastErr error
	for range MaxAttempts {
		publicID, err := New()
		if err != nil {
			return zero, err
		}
		result, err := insert(publicID)
		if err == nil {
			return result, nil
		}
		if !IsCollision(err) {
			return zero, err
		}
		lastErr = err
	}

	return zero, fmt.Errorf("%w after %d attempts: %v", ErrAttemptsExhausted, MaxAttempts, lastErr)
}

// InsertTx is [Insert] for an insert that runs inside an open transaction.
// PostgreSQL aborts the whole transaction when a statement fails, so retrying
// is only possible from a savepoint taken before each attempt.
//
// A non-collision error leaves the transaction aborted, exactly as it would
// without the retry; the caller's rollback still cleans it up.
func InsertTx[T any](ctx context.Context, tx Execer, insert func(publicID string) (T, error)) (T, error) {
	var zero T

	var lastErr error
	for range MaxAttempts {
		publicID, err := New()
		if err != nil {
			return zero, err
		}
		if _, err := tx.ExecContext(ctx, "SAVEPOINT "+savepointName); err != nil {
			return zero, err
		}
		result, err := insert(publicID)
		if err == nil {
			if _, err := tx.ExecContext(ctx, "RELEASE SAVEPOINT "+savepointName); err != nil {
				return zero, err
			}

			return result, nil
		}
		if !IsCollision(err) {
			return zero, err
		}
		lastErr = err
		if _, err := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+savepointName); err != nil {
			return zero, err
		}
	}

	return zero, fmt.Errorf("%w after %d attempts: %v", ErrAttemptsExhausted, MaxAttempts, lastErr)
}

// encode writes value as exactly [Length] Base58 characters, left-padded with
// the Base58 zero digit.
func encode(value *big.Int) string {
	out := make([]byte, Length)
	remaining := new(big.Int).Set(value)
	radix := big.NewInt(int64(len(Alphabet)))
	digit := new(big.Int)
	for i := Length - 1; i >= 0; i-- {
		remaining.DivMod(remaining, radix, digit)
		out[i] = Alphabet[digit.Int64()]
	}

	return string(out)
}
