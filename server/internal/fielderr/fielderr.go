// Package fielderr is a refusal that names the request field behind it. A
// package under internal/ returns one, and each adapter reports the field its
// own way: a Connect handler as a BadRequest field violation, publiractl as
// the flag the value came through.
package fielderr

import "errors"

// Invalid refuses a request over the value of one field.
type Invalid struct {
	Field string
	Err   error
}

func (e *Invalid) Error() string { return e.Err.Error() }

func (e *Invalid) Unwrap() error { return e.Err }

// Conflict refuses a value another record already holds.
type Conflict struct {
	Field string
}

func (e *Conflict) Error() string { return e.Field + " already exists" }

// Field names the field err refuses, or "" when err is neither an [*Invalid]
// nor a [*Conflict].
func Field(err error) string {
	var invalid *Invalid
	if errors.As(err, &invalid) {
		return invalid.Field
	}
	var conflict *Conflict
	if errors.As(err, &conflict) {
		return conflict.Field
	}
	return ""
}

// Within reports err's field as a field of parent, for a value that is
// validated on its own and sent inside the request field parent. Any other
// error is returned as it is.
func Within(parent string, err error) error {
	var invalid *Invalid
	if errors.As(err, &invalid) {
		return &Invalid{Field: parent + "." + invalid.Field, Err: invalid.Err}
	}
	return err
}
