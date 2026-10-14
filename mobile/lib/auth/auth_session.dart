/// The signed-in reader and the public-audience JWT the app holds for them.
///
/// This is what survives a restart: the token is what every API and
/// image-server request is authorized with, and the name and the icon are what
/// the reader's own rows are shown under without a round trip.
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.userPublicId,
    required this.userName,
    this.userIconUrl,
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
    final rawIconUrl = decoded['userIconUrl'];
    return AuthSession(
      accessToken: accessToken,
      userPublicId: decoded['userPublicId'] is String
          ? decoded['userPublicId']! as String
          : '',
      userName: decoded['userName'] is String
          ? decoded['userName']! as String
          : '',
      userIconUrl: rawIconUrl is String ? Uri.tryParse(rawIconUrl) : null,
      expiresAt: rawExpiresAt is String
          ? DateTime.tryParse(rawExpiresAt)?.toUtc()
          : null,
    );
  }

  final String accessToken;
  final String userPublicId;
  final String userName;

  /// Absolute image-server URL of the icon the account shows, and `null` for
  /// one that shows none.
  ///
  /// A replaced icon is stored under a new URL and the old one stops
  /// answering, so a URL kept from an earlier launch can name nothing by now;
  /// the launch reads the account again, and a URL that fails in between is
  /// drawn as the fallback an account without an icon gets.
  final Uri? userIconUrl;

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
    required Uri? userIconUrl,
  }) {
    return AuthSession(
      accessToken: accessToken,
      userPublicId: userPublicId,
      userName: userName,
      userIconUrl: userIconUrl,
      expiresAt: expiresAt,
    );
  }

  /// This reader under the token `ChangePassword` hands back, which replaces
  /// the one every other device is now signed out with.
  AuthSession withAccessToken(String accessToken, {DateTime? expiresAt}) {
    return AuthSession(
      accessToken: accessToken,
      userPublicId: userPublicId,
      userName: userName,
      userIconUrl: userIconUrl,
      expiresAt: expiresAt,
    );
  }

  Map<String, Object?> toJson() {
    return {
      'accessToken': accessToken,
      'userPublicId': userPublicId,
      'userName': userName,
      if (userIconUrl != null) 'userIconUrl': userIconUrl!.toString(),
      if (expiresAt != null) 'expiresAt': expiresAt!.toIso8601String(),
    };
  }
}
