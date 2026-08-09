package publicid_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/publicid"
)

// minEntropyBits is the entropy the format is required to carry; 58^12 is
// worth about 70.3 bits.
const minEntropyBits = 70

func TestSpaceCarriesEnoughEntropy(t *testing.T) {
	space := new(big.Int).Exp(big.NewInt(int64(len(publicid.Alphabet))), big.NewInt(publicid.Length), nil)
	floor := new(big.Int).Lsh(big.NewInt(1), minEntropyBits)
	if space.Cmp(floor) < 0 {
		t.Fatalf("%d^%d = %s, want at least 2^%d", len(publicid.Alphabet), publicid.Length, space, minEntropyBits)
	}
}

func TestAlphabetIsStandardBase58(t *testing.T) {
	if len(publicid.Alphabet) != 58 {
		t.Fatalf("alphabet length = %d, want 58", len(publicid.Alphabet))
	}
	for _, excluded := range []byte{'0', 'O', 'I', 'l'} {
		if strings.IndexByte(publicid.Alphabet, excluded) >= 0 {
			t.Fatalf("alphabet contains %q, which standard Base58 excludes", excluded)
		}
	}
	seen := make(map[byte]struct{}, len(publicid.Alphabet))
	for i := range len(publicid.Alphabet) {
		if _, duplicate := seen[publicid.Alphabet[i]]; duplicate {
			t.Fatalf("alphabet repeats %q", publicid.Alphabet[i])
		}
		seen[publicid.Alphabet[i]] = struct{}{}
	}
}

func TestNewGeneratesDistinctValidIDs(t *testing.T) {
	const samples = 10000

	seen := make(map[string]struct{}, samples)
	// The old format was 12 uppercase hex digits. At least one sample has to
	// fall outside it, or the new values would still look like UUID fragments.
	outsideLegacyFormat := false
	for range samples {
		id, err := publicid.New()
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		if !publicid.Valid(id) {
			t.Fatalf("New returned %q, which is not a valid public ID", id)
		}
		if _, duplicate := seen[id]; duplicate {
			t.Fatalf("New returned %q twice in %d samples", id, samples)
		}
		seen[id] = struct{}{}
		if strings.ContainsFunc(id, func(r rune) bool {
			return !strings.ContainsRune("0123456789ABCDEF", r)
		}) {
			outsideLegacyFormat = true
		}
	}
	if !outsideLegacyFormat {
		t.Fatalf("every one of %d samples was 12 uppercase hex digits", samples)
	}
}

func TestValid(t *testing.T) {
	cases := []struct {
		name  string
		id    string
		valid bool
	}{
		{"generated_shape", "4ERDqTx5YB8m", true},
		{"all_lowest_digit", "111111111111", true},
		{"all_highest_digit", "zzzzzzzzzzzz", true},
		{"empty", "", false},
		{"too_short", "4ERDqTx5YB8", false},
		{"too_long", "4ERDqTx5YB8mm", false},
		{"digit_zero", "4ERDqTx5YB80", false},
		{"uppercase_o", "4ERDqTx5YB8O", false},
		{"uppercase_i", "4ERDqTx5YB8I", false},
		{"lowercase_l", "4ERDqTx5YB8l", false},
		{"hyphen", "4ERDqTx5YB-m", false},
		{"multibyte", "4ERDqTx5YB8あ", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := publicid.Valid(tc.id); got != tc.valid {
				t.Fatalf("Valid(%q) = %t, want %t", tc.id, got, tc.valid)
			}
		})
	}
}

func TestIsCollision(t *testing.T) {
	cases := []struct {
		name      string
		err       error
		collision bool
	}{
		{"series_public_id", uniqueViolation("series_public_id_key"), true},
		{"episodes_public_id", uniqueViolation("episodes_public_id_key"), true},
		{"tenants_public_id", uniqueViolation("tenants_public_id_key"), true},
		{"users_public_id", uniqueViolation("users_public_id_key"), true},
		{"platform_users_public_id", uniqueViolation("platform_users_public_id_key"), true},
		{"creators_public_id", uniqueViolation("creators_public_id_key"), true},
		{"labels_public_id", uniqueViolation("labels_public_id_key"), true},
		{"access_tickets_tenant_public_id", uniqueViolation("access_tickets_tenant_public_id_key"), true},
		{"wrapped", fmt.Errorf("create series: %w", uniqueViolation("series_public_id_key")), true},
		{"email", uniqueViolation("users_email_key"), false},
		{"domain", uniqueViolation("tenants_domain_key"), false},
		{"admin_domain", uniqueViolation("tenants_admin_domain_key"), false},
		{"active_ticket_index", uniqueViolation("idx_access_tickets_active_user_episode"), false},
		{"unnamed_constraint", uniqueViolation(""), false},
		{"other_sqlstate", &pgconn.PgError{Code: "23503", ConstraintName: "series_public_id_key"}, false},
		{"plain_error", errors.New("boom"), false},
		{"nil", nil, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := publicid.IsCollision(tc.err); got != tc.collision {
				t.Fatalf("IsCollision(%v) = %t, want %t", tc.err, got, tc.collision)
			}
		})
	}
}

func TestInsertRetriesUntilTheIDIsFree(t *testing.T) {
	used := map[string]struct{}{}
	attempts := 0

	got, err := publicid.Insert(func(publicID string) (string, error) {
		attempts++
		if _, duplicate := used[publicID]; duplicate {
			t.Fatalf("attempt %d reused public ID %q", attempts, publicID)
		}
		used[publicID] = struct{}{}
		if attempts < 2 {
			return "", uniqueViolation("series_public_id_key")
		}

		return publicID, nil
	})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}
	if !publicid.Valid(got) {
		t.Fatalf("Insert returned %q, which is not a valid public ID", got)
	}
}

func TestInsertDoesNotRetryOtherErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"email_conflict", uniqueViolation("users_email_key")},
		{"active_ticket_index", uniqueViolation("idx_access_tickets_active_user_episode")},
		{"unrelated", errors.New("connection refused")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			attempts := 0
			_, err := publicid.Insert(func(string) (string, error) {
				attempts++

				return "", tc.err
			})
			if !errors.Is(err, tc.err) {
				t.Fatalf("Insert error = %v, want %v", err, tc.err)
			}
			if attempts != 1 {
				t.Fatalf("attempts = %d, want 1", attempts)
			}
		})
	}
}

func TestInsertGivesUpAfterMaxAttempts(t *testing.T) {
	attempts := 0

	_, err := publicid.Insert(func(string) (string, error) {
		attempts++

		return "", uniqueViolation("series_public_id_key")
	})
	if !errors.Is(err, publicid.ErrAttemptsExhausted) {
		t.Fatalf("Insert error = %v, want ErrAttemptsExhausted", err)
	}
	if attempts != publicid.MaxAttempts {
		t.Fatalf("attempts = %d, want %d", attempts, publicid.MaxAttempts)
	}
	assertCollisionNotUnwrappable(t, err)
}

func TestInsertTxGivesUpAfterMaxAttempts(t *testing.T) {
	execer := &recordingExecer{}
	attempts := 0

	_, err := publicid.InsertTx(context.Background(), execer, func(string) (string, error) {
		attempts++

		return "", uniqueViolation("tenants_public_id_key")
	})
	if !errors.Is(err, publicid.ErrAttemptsExhausted) {
		t.Fatalf("InsertTx error = %v, want ErrAttemptsExhausted", err)
	}
	if attempts != publicid.MaxAttempts {
		t.Fatalf("attempts = %d, want %d", attempts, publicid.MaxAttempts)
	}
	assertCollisionNotUnwrappable(t, err)
}

// Callers answer a unique violation by naming the conflicting field to the
// client ("email already exists"). Exhausting the retries is an internal
// failure, so the collision behind it must not stay reachable by errors.As.
func assertCollisionNotUnwrappable(t *testing.T, err error) {
	t.Helper()

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		t.Fatalf("error unwraps to %v, want the collision kept as text", pgErr)
	}
	if publicid.IsCollision(err) {
		t.Fatalf("IsCollision(%v) = true, want false", err)
	}
	if !strings.Contains(err.Error(), "23505") {
		t.Fatalf("error = %q, want the collision reported in the message", err)
	}
}

func TestInsertTxWrapsEachAttemptInASavepoint(t *testing.T) {
	execer := &recordingExecer{}
	attempts := 0

	if _, err := publicid.InsertTx(context.Background(), execer, func(publicID string) (string, error) {
		attempts++
		if attempts < 2 {
			return "", uniqueViolation("tenants_public_id_key")
		}

		return publicID, nil
	}); err != nil {
		t.Fatalf("InsertTx: %v", err)
	}

	want := []string{
		"SAVEPOINT publira_public_id",
		"ROLLBACK TO SAVEPOINT publira_public_id",
		"SAVEPOINT publira_public_id",
		"RELEASE SAVEPOINT publira_public_id",
	}
	assertStatements(t, execer.statements, want)
}

func TestInsertTxLeavesOtherErrorsToTheCaller(t *testing.T) {
	execer := &recordingExecer{}
	sentinel := uniqueViolation("tenants_domain_key")

	_, err := publicid.InsertTx(context.Background(), execer, func(string) (string, error) {
		return "", sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("InsertTx error = %v, want %v", err, sentinel)
	}
	assertStatements(t, execer.statements, []string{"SAVEPOINT publira_public_id"})
}

func assertStatements(t *testing.T, got, want []string) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("statements = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("statements = %v, want %v", got, want)
		}
	}
}

func uniqueViolation(constraint string) error {
	return &pgconn.PgError{Code: "23505", ConstraintName: constraint}
}

type recordingExecer struct {
	statements []string
}

func (e *recordingExecer) ExecContext(_ context.Context, query string, _ ...any) (sql.Result, error) {
	e.statements = append(e.statements, query)

	return driverResult{}, nil
}

type driverResult struct{}

func (driverResult) LastInsertId() (int64, error) { return 0, nil }

func (driverResult) RowsAffected() (int64, error) { return 0, nil }
