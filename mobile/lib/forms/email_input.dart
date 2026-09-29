import 'package:publira/l10n/gen/app_messages.dart';

/// One `@` with something on either side and no whitespace. The API parses the
/// address properly; this only catches what was obviously not one.
final emailShape = RegExp(r'^[^\s@]+@[^\s@]+$');

/// Why [value] is not an address the auth forms can send, or `null` when it
/// is one.
///
/// The length is left to the API: an address it refuses comes back as the
/// form's own failure copy, while a bound written here would have to be kept
/// in step with a limit this screen cannot see.
String? validateAuthEmail(AppMessages messages, String value) {
  final email = value.trim();
  if (email.isEmpty) {
    return messages.authEmailRequired;
  }
  if (!emailShape.hasMatch(email)) {
    return messages.authEmailInvalid;
  }
  return null;
}
