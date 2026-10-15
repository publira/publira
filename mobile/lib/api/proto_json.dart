import 'dart:convert';

import 'package:fixnum/fixnum.dart';
import 'package:protobuf/protobuf.dart';

/// Merges [json], a message in the proto3 JSON format, into [message].
///
/// A field this build does not know is skipped, so a server that has grown a
/// field still answers an older app. An enum value this build does not know
/// is not dropped with it: it is kept in [GeneratedMessage.unknownFields]
/// under the field's number, which is where the binary decoder puts one, so
/// [carriesUnknownEnum] can tell it from the zero value protojson omits. JSON
/// names the value rather than numbering it, so it is the name that is kept.
///
/// Throws [FormatException] for a value of the wrong type.
T mergeProto3Json<T extends GeneratedMessage>(T message, Object? json) {
  message.mergeFromProto3Json(json, ignoreUnknownFields: true);
  _keepUnknownEnums(message, json);
  return message;
}

/// Whether [message] was answered with a value of its enum field
/// [tagNumber] that this build does not know, which the field itself reads as
/// its zero value.
bool carriesUnknownEnum(GeneratedMessage message, int tagNumber) =>
    message.unknownFields.hasField(tagNumber);

void _keepUnknownEnums(GeneratedMessage message, Object? json) {
  if (json is! Map) {
    return;
  }
  final fields = message.info_.byName;
  for (final MapEntry(:key, :value) in json.entries) {
    final field = fields[key];
    if (field == null || value == null || field.isMapField) {
      continue;
    }
    final values = field.isRepeated && value is List ? value : [value];
    if (field.isEnum) {
      for (final item in values) {
        if (item is String && !field.enumValues!.any((e) => e.name == item)) {
          message.unknownFields.mergeLengthDelimitedField(
            field.tagNumber,
            utf8.encode(item),
          );
        } else if (item is int && field.valueOf!(item) == null) {
          message.unknownFields.mergeVarintField(field.tagNumber, Int64(item));
        }
      }
    } else if (field.isGroupOrMessage) {
      final Object? decoded = message.getField(field.tagNumber);
      final messages = decoded is List ? decoded : [decoded];
      // The decoder keeps every element of a repeated message, so the two
      // lists line up.
      for (var i = 0; i < values.length && i < messages.length; i++) {
        if (messages[i] case final GeneratedMessage nested) {
          _keepUnknownEnums(nested, values[i]);
        }
      }
    }
  }
}
