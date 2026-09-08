// Package dberr classifies PostgreSQL errors that handlers have to react to
// instead of turning into a generic internal error.
package dberr

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// uniqueViolationCode is the SQLSTATE PostgreSQL reports for a violated unique
// constraint.
const uniqueViolationCode = "23505"

// exclusionViolationCode is the SQLSTATE PostgreSQL reports for a violated
// exclusion constraint, which is how episode_free_windows refuses two periods
// that overlap on the same episode.
const exclusionViolationCode = "23P01"

// IsUniqueViolation reports whether err is a unique constraint violation.
func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolationCode
}

// IsExclusionViolation reports whether err is an exclusion constraint
// violation. The conflicting row is not part of the error, so a caller that
// wants to name it has to read it back itself.
func IsExclusionViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == exclusionViolationCode
}

// UniqueViolationConstraint returns the name of the constraint err violated, or
// "" when err is not a unique constraint violation. Use it when the reaction
// depends on which constraint was hit; use [IsUniqueViolation] when it does not.
func UniqueViolationConstraint(err error) string {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != uniqueViolationCode {
		return ""
	}

	return pgErr.ConstraintName
}
