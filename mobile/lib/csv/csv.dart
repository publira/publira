/// The CSV the reader exports, laid out the way the site's downloads are so it
/// opens the same way in a spreadsheet: UTF-8 with a byte order mark, CRLF
/// line endings, and RFC 4180 quoting.
library;

/// The UTF-8 byte order mark, which is what makes Excel read the text as UTF-8.
const csvBom = '﻿';

final _needsQuotes = RegExp(r'[",\r\n]');
final _formulaLead = RegExp(r'^[=+\-@\t\r]');

/// `double.tryParse` skips surrounding whitespace, which a number field never
/// has.
bool _isNumber(String field) =>
    field.trim() == field && (double.tryParse(field)?.isFinite ?? false);

/// A field a spreadsheet would read as a formula is written with a leading
/// apostrophe, since the titles are written by the tenant's staff rather than
/// by the reader opening the file. A signed number is a value, not a formula,
/// and is left as it is.
String _neutralize(String field) =>
    _formulaLead.hasMatch(field) && !_isNumber(field) ? "'$field" : field;

/// RFC 4180 quoting, applied only where the field needs it.
String _encodeField(String raw) {
  final field = _neutralize(raw);
  return _needsQuotes.hasMatch(field)
      ? '"${field.replaceAll('"', '""')}"'
      : field;
}

/// One row, with the CRLF that ends it.
String encodeCsvRow(List<String> fields) =>
    '${fields.map(_encodeField).join(',')}\r\n';
