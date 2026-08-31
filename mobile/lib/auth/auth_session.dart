/// The signed-in reader and the public-audience JWT the app holds for them.
///
/// This is what survives a restart: the token is what every API and
/// image-server request is authorized with, and the name is what the account
/// screen shows without a round trip.
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.userPublicId,
    required this.userName,
    this.expiresAt,
  });

  /// Reads a session written by [toJson].
  ///
  /// Returns `null` for anything this build cannot read, so a value left by an
  /// older format is dropped rather than failing the launch.
  static AuthSession? fromJson(Object? decoded) {
    if (decoded is! Map) {
      return null;
    }
    final accessToken = decoded['accessToken'];
    if (accessToken is! String || accessToken.isEmpty) {
      return null;
    }
    final rawExpiresAt = decoded['expiresAt'];
    return AuthSession(
      accessToken: accessToken,
      userPublicId: decoded['userPublicId'] is String
          ? decoded['userPublicId']! as String
          : '',
      userName: decoded['userName'] is String
          ? decoded['userName']! as String
          : '',
      expiresAt: rawExpiresAt is String
          ? DateTime.tryParse(rawExpiresAt)?.toUtc()
          : null,
    );
  }

  final String accessToken;
  final String userPublicId;
  final String userName;

  /// When the API stops accepting [accessToken]. `null` when the server sent a
  /// timestamp this build could not read, in which case only the API can say
  /// whether the token is still good.
  final DateTime? expiresAt;

  /// Whether [now] is past [expiresAt], so the app can drop a token the API is
  /// certain to reject instead of presenting the reader as signed in.
  bool hasExpired(DateTime now) {
    final at = expiresAt;
    return at != null && !now.toUtc().isBefore(at);
  }

  AuthSession withUser({
    required String userPublicId,
    required String userName,
  }) {
    return AuthSession(
      accessToken: accessToken,
      userPublicId: userPublicId,
      userName: userName,
      expiresAt: expiresAt,
    );
  }

  Map<String, Object?> toJson() {
    return {
      'accessToken': accessToken,
      'userPublicId': userPublicId,
      'userName': userName,
      if (expiresAt != null) 'expiresAt': expiresAt!.toIso8601String(),
    };
  }
}
