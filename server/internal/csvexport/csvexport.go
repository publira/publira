// Package csvexport encodes the CSV files the consoles download. Every export
// goes through it, so they all open the same way in a spreadsheet: UTF-8 with
// a byte order mark, which is what makes Excel read the text as UTF-8, CRLF
// line endings, and RFC 4180 quoting.
package csvexport

import (
	"bytes"
	"encoding/csv"
	"strconv"
	"strings"
)

// bom is the UTF-8 byte order mark.
const bom = "\xEF\xBB\xBF"

// Writer builds one CSV file in memory.
type Writer struct {
	buf bytes.Buffer
	csv *csv.Writer
}

// New starts a file with its header row.
func New(header ...string) *Writer {
	w := &Writer{}
	w.buf.WriteString(bom)
	w.csv = csv.NewWriter(&w.buf)
	w.csv.UseCRLF = true
	w.Row(header...)
	return w
}

// Row appends one record. A field a spreadsheet would read as a formula is
// written with a leading apostrophe, since the text can come from a less
// privileged account than the one opening the file.
func (w *Writer) Row(fields ...string) {
	cells := make([]string, len(fields))
	for i, field := range fields {
		cells[i] = neutralize(field)
	}
	// Writing to a bytes.Buffer cannot fail, so the error Bytes reports is the
	// only one there is.
	_ = w.csv.Write(cells)
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

// Bytes ends the file and returns its content.
func (w *Writer) Bytes() ([]byte, error) {
	w.csv.Flush()
	if err := w.csv.Error(); err != nil {
		return nil, err
	}
	return w.buf.Bytes(), nil
}
