package locale

import (
	"errors"
	"fmt"
	"strings"

	localegen "github.com/publira/publira/server/internal/locale/gen"
)

// ErrUnknownMessage is returned for a key no catalog carries. Every key is
// compiled from the same catalogs, so this is a caller naming one that has
// been renamed or removed.
var ErrUnknownMessage = errors.New("no catalog carries this message key")

// ErrMissingValue is returned when a message reads a variable the caller
// passed no value for. MessageFormat would render the placeholder itself, and
// a mail reading "{$tenant_name}" is worse than one that is not sent.
var ErrMissingValue = errors.New("the message reads a variable with no value")

// Message renders the shared catalog message key in the locale code names,
// with the variables of the message taken from values.
func Message(code, key string, values map[string]string) (string, error) {
	catalog, ok := localegen.Messages[code]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrUnresolved, code)
	}
	parts, ok := catalog[key]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrUnknownMessage, key)
	}

	var rendered strings.Builder
	for _, part := range parts {
		if part.Variable == "" {
			rendered.WriteString(part.Text)
			continue
		}
		value, ok := values[part.Variable]
		if !ok {
			return "", fmt.Errorf("%w: %s reads %s", ErrMissingValue, key, part.Variable)
		}
		rendered.WriteString(value)
	}

	return rendered.String(), nil
}
