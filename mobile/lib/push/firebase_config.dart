import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// The Firebase project this build receives push notifications from.
///
/// The values are the ones the Firebase console shows for the project's
/// Android and iOS apps. They arrive through `--dart-define`, the way every
/// other connection setting the app has does, rather than through a
/// `google-services.json` / `GoogleService-Info.plist` committed to the
/// repository: a build serves one tenant and one Firebase project, and which
/// project that is belongs to whoever builds it. Passing the values to
/// [FirebaseOptions] also means the Android build needs no `google-services`
/// Gradle plugin.
///
/// A build given none of them has no Firebase project, so push is off and the
/// account switch says so.
@immutable
class FirebaseConfig {
  const FirebaseConfig({
    required this.projectId,
    required this.messagingSenderId,
    required this.androidApiKey,
    required this.androidAppId,
    required this.iosApiKey,
    required this.iosAppId,
    required this.iosBundleId,
  });

  /// The configuration this build was given, or `null` when it was given none.
  ///
  /// Returns `null` as soon as one of the values every platform needs is
  /// missing, rather than handing [FirebaseOptions] a half-filled project that
  /// would only fail once the app asked for a token.
  static FirebaseConfig? fromEnvironment() {
    const config = FirebaseConfig(
      projectId: String.fromEnvironment('PUBLIRA_FIREBASE_PROJECT_ID'),
      messagingSenderId: String.fromEnvironment(
        'PUBLIRA_FIREBASE_MESSAGING_SENDER_ID',
      ),
      androidApiKey: String.fromEnvironment('PUBLIRA_FIREBASE_ANDROID_API_KEY'),
      androidAppId: String.fromEnvironment('PUBLIRA_FIREBASE_ANDROID_APP_ID'),
      iosApiKey: String.fromEnvironment('PUBLIRA_FIREBASE_IOS_API_KEY'),
      iosAppId: String.fromEnvironment('PUBLIRA_FIREBASE_IOS_APP_ID'),
      iosBundleId: String.fromEnvironment('PUBLIRA_FIREBASE_IOS_BUNDLE_ID'),
    );
    if (config.projectId.isEmpty || config.messagingSenderId.isEmpty) {
      return null;
    }
    return config;
  }

  final String projectId;
  final String messagingSenderId;
  final String androidApiKey;
  final String androidAppId;
  final String iosApiKey;
  final String iosAppId;
  final String iosBundleId;

  /// The options to initialize Firebase with on [platform], or `null` when
  /// this build carries no app for it.
  ///
  /// The web has no entry: `flutter run -d chrome` is a development
  /// convenience rather than a shipped target, and a service worker is what
  /// web push would need on top of these values.
  FirebaseOptions? optionsFor(TargetPlatform platform, {bool isWeb = kIsWeb}) {
    if (isWeb) {
      return null;
    }
    switch (platform) {
      case TargetPlatform.android:
        if (androidApiKey.isEmpty || androidAppId.isEmpty) {
          return null;
        }
        return FirebaseOptions(
          apiKey: androidApiKey,
          appId: androidAppId,
          messagingSenderId: messagingSenderId,
          projectId: projectId,
        );
      case TargetPlatform.iOS:
        if (iosApiKey.isEmpty || iosAppId.isEmpty) {
          return null;
        }
        return FirebaseOptions(
          apiKey: iosApiKey,
          appId: iosAppId,
          messagingSenderId: messagingSenderId,
          projectId: projectId,
          iosBundleId: iosBundleId.isEmpty ? null : iosBundleId,
        );
      case TargetPlatform.fuchsia:
      case TargetPlatform.linux:
      case TargetPlatform.macOS:
      case TargetPlatform.windows:
        return null;
    }
  }
}
