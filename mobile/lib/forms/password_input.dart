import 'package:publira/l10n/gen/app_messages.dart';

/// The longest password `CreateUser` and the site's own forms take, counted in
/// code points the way they count it.
const maxPasswordLength = 1024;

/// Why [value] is not a password a form that sets one can send, or `null`
/// when it is one.
///
/// The API trims the password it is given, so one made of whitespace alone is
/// as missing as an empty one.
String? validateNewPassword(AppMessages messages, String value) {
  if (value.trim().isEmpty) {
    return messages.authPasswordRequired;
  }
  if (value.runes.length > maxPasswordLength) {
    return messages.authPasswordTooLong;
  }
  return null;
}

/// Why [value] does not repeat [password], or `null` when it does.
String? validatePasswordConfirmation(
  AppMessages messages,
  String value, {
  required String password,
}) {
  if (value.isEmpty) {
    return messages.authPasswordConfirmRequired;
  }
  if (value != password) {
    return messages.authPasswordMismatch;
  }
  return null;
}
