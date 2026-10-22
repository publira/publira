/// The signed-in reader and the public-audience JWT the app holds for them.
///
/// `AuthService/Login` answers an email address and a password with that
/// token, which lives 24 hours and is revoked by `credentials_version`.
///
/// This is what survives a restart: the token is what every API and
/// image-server request is authorized with, so a purchased or ticketed paid
/// episode reads on the device the same way it does in `web-storefront`, and
/// the name and the icon are what the reader's own rows are shown under
/// without a round trip.
///
/// Nothing signs the reader back in on its own. Once the token is gone, the
/// reader signs in again.
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.userPublicId,
    required this.userName,
    this.userIconUrl,
    this.userIconPresetId,
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
    final rawIconPresetId = decoded['userIconPresetId'];
    return AuthSession(
      accessToken: accessToken,
      userPublicId: decoded['userPublicId'] is String
          ? decoded['userPublicId']! as String
          : '',
      userName: decoded['userName'] is String
          ? decoded['userName']! as String
          : '',
      userIconUrl: rawIconUrl is String ? Uri.tryParse(rawIconUrl) : null,
      userIconPresetId: rawIconPresetId is String && rawIconPresetId.isNotEmpty
          ? rawIconPresetId
          : null,
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

  /// The tenant preset [userIconUrl] shows, as `AuthService.SelectMyIcon`
  /// names it, and `null` for an uploaded icon or none.
  final String? userIconPresetId;

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
    required String? userIconPresetId,
  }) {
    return AuthSession(
      accessToken: accessToken,
      userPublicId: userPublicId,
      userName: userName,
      userIconUrl: userIconUrl,
      userIconPresetId: userIconPresetId,
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
      userIconPresetId: userIconPresetId,
      expiresAt: expiresAt,
    );
  }

  Map<String, Object?> toJson() {
    return {
      'accessToken': accessToken,
      'userPublicId': userPublicId,
      'userName': userName,
      if (userIconUrl != null) 'userIconUrl': userIconUrl!.toString(),
      if (userIconPresetId != null) 'userIconPresetId': userIconPresetId,
      if (expiresAt != null) 'expiresAt': expiresAt!.toIso8601String(),
    };
  }
}
