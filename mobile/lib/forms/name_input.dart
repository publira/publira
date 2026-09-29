import 'package:publira/l10n/gen/app_messages.dart';

/// The longest display name `CreateUser`, `UpdateMe`, and the site's own forms
/// take, counted in code points the way they count it.
const maxDisplayNameLength = 100;

/// Why [value] is not a display name a form can send, or `null` when it is
/// one.
String? validateDisplayName(AppMessages messages, String value) {
  final name = value.trim();
  if (name.isEmpty) {
    return messages.authNameRequired;
  }
  if (name.runes.length > maxDisplayNameLength) {
    return messages.authNameTooLong;
  }
  return null;
}
