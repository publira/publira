import 'package:flutter/foundation.dart';

/// Which store the registered device belongs to, as
/// `publira.v1.NotificationService` names it.
enum PushPlatform {
  android,
  ios;

  /// The platform the app is running on. Only the two platforms the app ships
  /// on can register with FCM, so anything else answers `null` and registers
  /// nothing.
  static PushPlatform? current([TargetPlatform? platform]) {
    return switch (platform ?? defaultTargetPlatform) {
      TargetPlatform.android => PushPlatform.android,
      TargetPlatform.iOS => PushPlatform.ios,
      _ => null,
    };
  }
}

/// What a value FCM addresses this install by is, as
/// `publira.v1.NotificationService` names it.
///
/// The server sends an installation ID through FCM's `fid` target and a
/// registration token through `token`, and cannot tell the two apart from the
/// value.
enum PushTokenType {
  /// A registration token, which releases of the app before the move to
  /// installation IDs registered and stored. This release never obtains one,
  /// only reads one such a release left on the device.
  registrationToken,

  /// A Firebase Installation ID, which is what the device registers this
  /// install under.
  installationId,
}

/// The value this install is registered on the server under, and what kind
/// of value it is.
@immutable
class PushToken {
  const PushToken({required this.value, required this.type});

  const PushToken.installationId(this.value)
    : type = PushTokenType.installationId;

  final String value;
  final PushTokenType type;

  @override
  bool operator ==(Object other) =>
      other is PushToken && other.value == value && other.type == type;

  @override
  int get hashCode => Object.hash(value, type);

  @override
  String toString() => 'PushToken(${type.name}, $value)';
}

/// The device half of `publira.v1.NotificationService`.
///
/// Both calls need the reader's session, so they are only made while one is in
/// hand: signing out unregisters before the token is dropped.
abstract class PushRepository {
  /// Records [token] against the signed-in reader with `RegisterPushDevice`,
  /// together with what kind of value it is.
  ///
  /// The value is the identity on the server, so registering one another
  /// reader left on the same device moves it rather than adding a second
  /// registration, and a shared phone does not push one reader's episodes to
  /// the next.
  Future<void> register({
    required PushToken token,
    required PushPlatform platform,
  });

  /// Takes the registration under [token] off the server, which identifies it
  /// by the value alone.
  Future<void> unregister(String token);
}
