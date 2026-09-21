// Package csvexport encodes the CSV files the consoles download. Every export
// goes through it, so they all open the same way in a spreadsheet: UTF-8 with
// a byte order mark, which is what makes Excel read the text as UTF-8, CRLF
// line endings, and RFC 4180 quoting.
package csvexport

import (
	"bytes"
	"strconv"
	"strings"
)

// bom is the UTF-8 byte order mark.
const bom = "\xEF\xBB\xBF"

// Writer builds one CSV file in memory. It quotes fields itself rather than
// through encoding/csv, whose CRLF mode drops a lone \r and rewrites \n inside
// a field, so a field would no longer be the value it was given.
type Writer struct {
	buf bytes.Buffer
}

// New starts a file with its header row.
func New(header ...string) *Writer {
	w := &Writer{}
	w.buf.WriteString(bom)
	w.Row(header...)
	return w
}

// Row appends one record. A field a spreadsheet would read as a formula is
// written with a leading apostrophe, since the text can come from a less
// privileged account than the one opening the file.
func (w *Writer) Row(fields ...string) {
	for i, field := range fields {
		if i > 0 {
			w.buf.WriteByte(',')
		}
		field = neutralize(field)
		if !strings.ContainsAny(field, ",\"\r\n") {
			w.buf.WriteString(field)
			continue
		}
		w.buf.WriteByte('"')
		w.buf.WriteString(strings.ReplaceAll(field, `"`, `""`))
		w.buf.WriteByte('"')
	}
	w.buf.WriteString("\r\n")
}

// Bytes returns the file.
func (w *Writer) Bytes() []byte {
	return w.buf.Bytes()
}

// neutralize leaves a number as it is: a signed number is a value, not a
// formula.
func neutralize(field string) string {
	if field == "" || !strings.ContainsRune("=+-@\t\r", rune(field[0])) {
		return field
	}
	if _, err := strconv.ParseFloat(field, 64); err == nil {
		return field
	}
	return "'" + field
}
