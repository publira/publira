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

  /// The registration token this install holds, or `null` when the device
  /// could not mint one.
  Future<String?> token();

  /// Fires whenever FCM replaces the token, which the app answers by
  /// registering the new one.
  Stream<String> get tokenRefreshes;

  /// Messages that arrive while the app is in front, which the OS does not
  /// draw.
  Stream<PushMessage> get foregroundMessages;

  /// Taps on a notification that opened the app from the background.
  Stream<PushMessage> get openedMessages;

  /// The tap that launched a terminated app, or `null` when the app was
  /// started some other way.
  Future<PushMessage?> initialMessage();

  /// Invalidates this install's token, so a row the server still holds stops
  /// being deliverable and is dropped at the next send.
  Future<void> deleteToken();
}
