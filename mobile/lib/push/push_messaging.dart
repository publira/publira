import 'package:publira/push/push_message.dart';

/// What the reader's device answered when the app asked to notify them.
enum PushAuthorization {
  /// The reader allowed notifications, so a token can be registered.
  granted,

  /// The reader turned the prompt down, or notifications are off for the app
  /// in system settings. The app does not ask again on its own.
  denied,
}

/// The device's notification service, behind an interface so the app can be
/// driven in a test without Firebase.
///
/// Every method is called only after [PushMessaging] has been built, which
/// happens only for a build that carries a Firebase project.
abstract class PushMessaging {
  /// Asks the OS for permission — the iOS authorization prompt, and
  /// `POST_NOTIFICATIONS` on Android 13 and later — and reports the answer.
  /// Called the first time the reader turns the switch on, never at launch.
  Future<PushAuthorization> requestAuthorization();

  /// Registers this install for messages and answers the identifier the server
  /// sends them to — the Firebase Installation ID FCM registered it under — or
  /// `null` when the device could not register.
  Future<String?> token();

  /// Fires whenever the device is registered under an identifier, the one
  /// [token] answers included, which the app answers by registering it on the
  /// server when it is not the one already there.
  Stream<String> get tokenRefreshes;

  /// Messages that arrive while the app is in front, which the OS does not
  /// draw.
  Stream<PushMessage> get foregroundMessages;

  /// Taps on a notification that opened the app from the background.
  Stream<PushMessage> get openedMessages;

  /// The tap that launched a terminated app, or `null` when the app was
  /// started some other way.
  Future<PushMessage?> initialMessage();

  /// Unregisters this install from FCM, so a row the server still holds stops
  /// being deliverable and is dropped at the next send.
  Future<void> deleteToken();
}
