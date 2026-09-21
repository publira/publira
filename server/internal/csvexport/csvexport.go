// Package csvexport encodes the CSV files the consoles download. Every export
// goes through it, so they all open the same way in a spreadsheet: UTF-8 with
// a byte order mark, which is what makes Excel read the text as UTF-8, CRLF
// line endings, and RFC 4180 quoting.
package csvexport

import (
	"bytes"
	"encoding/csv"
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

// Row appends one record.
func (w *Writer) Row(fields ...string) {
	// Writing to a bytes.Buffer cannot fail, so the error Bytes reports is the
	// only one there is.
	_ = w.csv.Write(fields)
}

// Bytes ends the file and returns its content.
func (w *Writer) Bytes() ([]byte, error) {
	w.csv.Flush()
	if err := w.csv.Error(); err != nil {
		return nil, err
	}
	return w.buf.Bytes(), nil
}
