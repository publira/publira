import 'dart:convert';
import 'dart:typed_data';

/// The type name connect-go gives a `google.rpc.BadRequest` detail.
const _badRequestType = 'google.rpc.BadRequest';

/// The type name connect-go gives a `google.rpc.ErrorInfo` detail.
const _errorInfoType = 'google.rpc.ErrorInfo';

/// The `ErrorInfo.domain` the API sets on the reasons it owns. A reason under
/// any other domain is not one of the values below.
const _errorInfoDomain = 'publira';

/// The ErrorInfo reason the API refuses a rating, a checkout, or a store
/// purchase with when the reader is credited on the episode.
const readerCreditedOnEpisodeReason = 'READER_CREDITED_ON_EPISODE';

/// The ErrorInfo reason the API refuses to delete an account with when it is
/// the tenant's last active tenant admin.
const lastTenantAdminReason = 'LAST_TENANT_ADMIN';

/// The fields the `google.rpc.BadRequest` details of a Connect error body's
/// `details` name.
///
/// A detail's `value` is the message in protobuf binary, base64 without
/// padding. Only `BadRequest.field_violations` (1) and each violation's
/// `field` (1) are read; a detail that does not decode is skipped.
List<String> fieldViolationsOf(Object? details) {
  if (details is! List) {
    return const [];
  }
  final fields = <String>[];
  for (final detail in details) {
    if (detail is! Map || detail['type'] != _badRequestType) {
      continue;
    }
    final value = detail['value'];
    if (value is! String) {
      continue;
    }
    try {
      final message = base64.decode(base64.normalize(value));
      for (final violation in _lengthDelimited(message, 1)) {
        for (final field in _lengthDelimited(violation, 1)) {
          fields.add(utf8.decode(field));
        }
      }
    } on FormatException {
      continue;
    }
  }
  return fields;
}

/// The reasons the API's own `google.rpc.ErrorInfo` details in a Connect
/// error body's `details` name.
///
/// Read the way [fieldViolationsOf] reads its detail: `ErrorInfo.reason` (1)
/// and `ErrorInfo.domain` (2), and a detail that does not decode is skipped.
List<String> errorReasonsOf(Object? details) {
  if (details is! List) {
    return const [];
  }
  final reasons = <String>[];
  for (final detail in details) {
    if (detail is! Map || detail['type'] != _errorInfoType) {
      continue;
    }
    final value = detail['value'];
    if (value is! String) {
      continue;
    }
    try {
      final message = base64.decode(base64.normalize(value));
      final domains = _lengthDelimited(message, 2).map(utf8.decode);
      if (!domains.contains(_errorInfoDomain)) {
        continue;
      }
      reasons.addAll(_lengthDelimited(message, 1).map(utf8.decode));
    } on FormatException {
      continue;
    }
  }
  return reasons;
}

/// Every length-delimited value of field [number] in the protobuf [message].
///
/// Throws [FormatException] for a message that ends inside a field.
Iterable<Uint8List> _lengthDelimited(Uint8List message, int number) sync* {
  var offset = 0;
  int readVarint() {
    var result = 0;
    for (var shift = 0; shift < 64; shift += 7) {
      if (offset >= message.length) {
        throw const FormatException('truncated varint');
      }
      final byte = message[offset++];
      result |= (byte & 0x7f) << shift;
      if (byte & 0x80 == 0) {
        return result;
      }
    }
    throw const FormatException('varint too long');
  }

  void skip(int length) {
    if (length < 0 || offset + length > message.length) {
      throw const FormatException('truncated field');
    }
    offset += length;
  }

  while (offset < message.length) {
    final key = readVarint();
    switch (key & 7) {
      case 0:
        readVarint();
      case 1:
        skip(8);
      case 2:
        final length = readVarint();
        final start = offset;
        skip(length);
        if (key >> 3 == number) {
          yield Uint8List.sublistView(message, start, offset);
        }
      case 5:
        skip(4);
      default:
        throw FormatException('unsupported wire type ${key & 7}');
    }
  }
}
