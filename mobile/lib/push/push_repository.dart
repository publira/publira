import 'package:flutter/foundation.dart';

/// Which store issued the registration token, as
/// `publira.v1.NotificationService` names it.
enum PushPlatform {
  android('PUSH_PLATFORM_ANDROID'),
  ios('PUSH_PLATFORM_IOS');

  const PushPlatform(this.wireValue);

  /// The platform the app is running on. Only the two platforms the app ships
  /// on can hold a registration token, so anything else answers `null` and
  /// registers nothing.
  static PushPlatform? current([TargetPlatform? platform]) {
    return switch (platform ?? defaultTargetPlatform) {
      TargetPlatform.android => PushPlatform.android,
      TargetPlatform.iOS => PushPlatform.ios,
      _ => null,
    };
  }

  final String wireValue;
}

/// The device half of `publira.v1.NotificationService`.
///
/// Both calls need the reader's session, so they are only made while one is in
/// hand: signing out unregisters before the token is dropped.
abstract class PushRepository {
  /// Records [token] against the signed-in reader. Registering a token another
  /// reader left on the same device moves it, so a shared phone does not push
  /// one reader's episodes to the next.
  Future<void> register({
    required String token,
    required PushPlatform platform,
  });

  Future<void> unregister(String token);
}
