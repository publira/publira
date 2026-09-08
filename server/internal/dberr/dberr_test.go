package dberr_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/dberr"
)

func TestIsUniqueViolation(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"unique_violation", &pgconn.PgError{Code: "23505", ConstraintName: "users_email_key"}, true},
		{"wrapped", fmt.Errorf("create user: %w", &pgconn.PgError{Code: "23505"}), true},
		{"foreign_key_violation", &pgconn.PgError{Code: "23503"}, false},
		{"plain_error", errors.New("boom"), false},
		{"nil", nil, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := dberr.IsUniqueViolation(tc.err); got != tc.want {
				t.Fatalf("IsUniqueViolation(%v) = %t, want %t", tc.err, got, tc.want)
			}
		})
	}
}

func TestIsForeignKeyViolation(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"foreign_key_violation", &pgconn.PgError{Code: "23503", ConstraintName: "series_genres_tenant_genre_id_fkey"}, true},
		{"wrapped", fmt.Errorf("delete genre: %w", &pgconn.PgError{Code: "23503"}), true},
		{"unique_violation", &pgconn.PgError{Code: "23505"}, false},
		{"plain_error", errors.New("boom"), false},
		{"nil", nil, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := dberr.IsForeignKeyViolation(tc.err); got != tc.want {
				t.Fatalf("IsForeignKeyViolation(%v) = %t, want %t", tc.err, got, tc.want)
			}
		})
	}
}

func TestIsExclusionViolation(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"exclusion_violation", &pgconn.PgError{Code: "23P01", ConstraintName: "episode_free_windows_no_overlap"}, true},
		{"wrapped", fmt.Errorf("create free window: %w", &pgconn.PgError{Code: "23P01"}), true},
		{"unique_violation", &pgconn.PgError{Code: "23505"}, false},
		{"plain_error", errors.New("boom"), false},
		{"nil", nil, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := dberr.IsExclusionViolation(tc.err); got != tc.want {
				t.Fatalf("IsExclusionViolation(%v) = %t, want %t", tc.err, got, tc.want)
			}
		})
	}
}

func TestUniqueViolationConstraint(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"unique_violation", &pgconn.PgError{Code: "23505", ConstraintName: "tenants_domain_key"}, "tenants_domain_key"},
		{"wrapped", fmt.Errorf("create tenant: %w", &pgconn.PgError{Code: "23505", ConstraintName: "tenants_public_id_key"}), "tenants_public_id_key"},
		{"unnamed", &pgconn.PgError{Code: "23505"}, ""},
		{"other_sqlstate", &pgconn.PgError{Code: "23503", ConstraintName: "series_tenant_id_fkey"}, ""},
		{"plain_error", errors.New("boom"), ""},
		{"nil", nil, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := dberr.UniqueViolationConstraint(tc.err); got != tc.want {
				t.Fatalf("UniqueViolationConstraint(%v) = %q, want %q", tc.err, got, tc.want)
			}
		})
	}
}
