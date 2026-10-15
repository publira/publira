import 'package:protobuf/protobuf.dart';

/// Whether [message] was answered with a value of its enum field
/// [tagNumber] that this build does not know, which the field itself reads as
/// its zero value.
///
/// The binary decoder keeps such a value in [GeneratedMessage.unknownFields]
/// under the field's number, which is what tells it from a zero value the
/// server left out.
bool carriesUnknownEnum(GeneratedMessage message, int tagNumber) =>
    message.unknownFields.hasField(tagNumber);
