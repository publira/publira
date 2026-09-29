// The signing inputs a store build takes from the environment rather than
// from the app manifest, which holds no secrets and no account details.

/// The variable naming the Apple Developer team an iOS device build is signed
/// under, which the generated build configuration carries to Xcode.
const iosDevelopmentTeamVariable = 'PUBLIRA_IOS_DEVELOPMENT_TEAM';

/// The variable naming the keystore `android/app/build.gradle.kts` signs a
/// production release with.
const androidKeystoreVariable = 'PUBLIRA_ANDROID_KEYSTORE';

/// Thrown for a signing input that is not usable.
class SigningException implements Exception {
  const SigningException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// The team [environment] names, or null when it names none.
///
/// Throws a [SigningException] for a value that is not a Team ID.
String? iosDevelopmentTeam(Map<String, String> environment) {
  final team = environment[iosDevelopmentTeamVariable] ?? '';
  if (team.isEmpty) {
    return null;
  }
  if (!RegExp(r'^[A-Z0-9]{10}$').hasMatch(team)) {
    throw SigningException(
      '$iosDevelopmentTeamVariable must be the ten-character Team ID of an '
      'Apple Developer account, not $team',
    );
  }
  return team;
}
