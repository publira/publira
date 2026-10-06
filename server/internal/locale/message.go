package locale

import (
	"errors"
	"fmt"

	"github.com/kaptinlin/messageformat-go"
	mferrors "github.com/kaptinlin/messageformat-go/pkg/errors"

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

// ErrFormat is returned for any other fault MessageFormat reports while
// formatting a message, such as a value a function cannot take. The library
// would still write the message out with a fallback in place of the faulty
// part, and that is a mail worded wrongly all the same.
var ErrFormat = errors.New("the message cannot be formatted")

// Message renders the shared catalog message key in the locale code names,
// with the variables of the message taken from values.
//
// The catalog holds Unicode MessageFormat 2 source, and
// github.com/kaptinlin/messageformat-go formats it. That library passes the
// whole conformance suite of the MessageFormat Working Group as tagged
// LDML48.2, the version the catalog is written to and the one the npm
// messageformat package and package:messageformat implement. The other Go
// implementation, go.expect.digital/mf2 v0.1.0, skips 69 of the 461 cases of
// that suite as failing, :integer and :number among them.
func Message(code, key string, values map[string]any) (string, error) {
	tag, ok := localegen.Intl[code]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrUnresolved, code)
	}
	sources, ok := localegen.Messages[key]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrUnknownMessage, key)
	}

	rendered, err := format(tag, sources[code], values)
	if err != nil {
		return "", fmt.Errorf("%s: %w", key, err)
	}
	return rendered, nil
}

// format renders the MessageFormat 2 source in the BCP 47 tag, failing on
// every error the library reports rather than returning its fallback output.
//
// Bidi isolation is off, as it is in @publira/i18n: every catalog is written
// left to right, and the result becomes a subject line and plain text, where
// U+2068 and U+2069 would travel invisibly.
func format(tag, source string, values map[string]any) (string, error) {
	formatter, err := messageformat.Parse([]string{tag}, source,
		messageformat.WithBidiIsolation(messageformat.BidiNone))
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrFormat, err)
	}
	rendered, err := formatter.Format(values)
	if err != nil {
		var resolution *mferrors.MessageResolutionError
		if errors.As(err, &resolution) && resolution.Type == mferrors.ErrorTypeUnresolvedVariable {
			return "", fmt.Errorf("%w: %w", ErrMissingValue, err)
		}
		return "", fmt.Errorf("%w: %w", ErrFormat, err)
	}
	return rendered, nil
}
