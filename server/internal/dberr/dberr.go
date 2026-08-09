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

// IsUniqueViolation reports whether err is a unique constraint violation.
func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolationCode
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
