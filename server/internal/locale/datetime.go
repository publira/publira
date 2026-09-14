package locale

import (
	"fmt"
	"strconv"
	"strings"
	"time"
	// Embed the IANA time zone database so a display zone resolves without the
	// zoneinfo files of the runtime image (the server images are distroless).
	_ "time/tzdata"

	localegen "github.com/publira/publira/server/internal/locale/gen"
)

// FormatDateTime writes at as the wall clock of timeZone, worded the way the
// locale code names words it. The pattern is compiled from the same CLDR data
// `@publira/utils` formats with, so a moment reads the same on a screen and in
// the mail that announces it.
func FormatDateTime(at time.Time, code, timeZone string) (string, error) {
	fields, ok := localegen.DateTimeFormats[code]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrUnresolved, code)
	}
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		return "", fmt.Errorf("load time zone %q: %w", timeZone, err)
	}

	local := at.In(location)
	var written strings.Builder
	for _, field := range fields {
		switch field.Kind {
		case localegen.FieldLiteral:
			written.WriteString(field.Text)
		case localegen.FieldYear:
			writePadded(&written, local.Year(), field.Width)
		case localegen.FieldMonth:
			written.WriteString(field.Values[int(local.Month())-1])
		case localegen.FieldDay:
			writePadded(&written, local.Day(), field.Width)
		case localegen.FieldHour:
			written.WriteString(field.Values[local.Hour()])
		case localegen.FieldMinute:
			writePadded(&written, local.Minute(), field.Width)
		case localegen.FieldDayPeriod:
			written.WriteString(field.Values[local.Hour()])
		default:
			return "", fmt.Errorf("locale %s has a field this build cannot write (%d)", code, field.Kind)
		}
	}

	return written.String(), nil
}

func writePadded(written *strings.Builder, value, width int) {
	digits := strconv.Itoa(value)
	for range width - len(digits) {
		written.WriteByte('0')
	}
	written.WriteString(digits)
}
