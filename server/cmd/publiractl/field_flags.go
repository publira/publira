package main

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/publira/publira/server/internal/fielderr"
)

// fieldFlag is one numeric field of a settings message, given through a flag
// of its own so that a set command can change it alone.
type fieldFlag[T any] struct {
	// field is the field's path inside the message, as a refusal names it.
	field string
	flag  string
	usage string
	set   func(settings *T, value int)
}

// fieldFlags are the flags a set command declared, and the changes the ones
// given make to the stored settings.
type fieldFlags[T any] struct {
	flags map[string]string
	edits []func(*T)
}

var errNotAWholeNumber = errors.New("must be a whole number")

func declareFieldFlags[T any](f *commandFlags, fields []fieldFlag[T]) *fieldFlags[T] {
	declared := &fieldFlags[T]{flags: make(map[string]string, len(fields))}
	for _, field := range fields {
		declared.flags[field.field] = "--" + field.flag
		f.Func(field.flag, field.usage, func(v string) error {
			value, err := strconv.ParseInt(strings.TrimSpace(v), 10, 32)
			if err != nil {
				return errNotAWholeNumber
			}
			declared.edit(func(settings *T) { field.set(settings, int(value)) })
			return nil
		})
	}
	return declared
}

// edit records a change a flag given makes.
func (d *fieldFlags[T]) edit(change func(*T)) {
	d.edits = append(d.edits, change)
}

// apply is stored with every flag given applied, in the order they were given.
func (d *fieldFlags[T]) apply(stored T) T {
	for _, change := range d.edits {
		change(&stored)
	}
	return stored
}

// named names the flag behind a refusal of a field inside the request field
// parent.
func (d *fieldFlags[T]) named(parent string, err error) error {
	if flag := d.flags[strings.TrimPrefix(fielderr.Field(err), parent+".")]; flag != "" {
		return fmt.Errorf("%s: %w", flag, err)
	}
	return err
}
