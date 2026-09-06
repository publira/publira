import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:publira/push/firebase_config.dart';
import 'package:publira/push/push_message.dart';
import 'package:publira/push/push_messaging.dart';

/// [PushMessaging] backed by Firebase Cloud Messaging.
class FirebasePushMessaging implements PushMessaging {
  FirebasePushMessaging(this._messaging);

  /// Initializes Firebase for [config] and returns the messaging behind it, or
  /// `null` when this build or this platform carries no project.
  ///
  /// A failure to initialize is answered with `null` rather than an exception:
  /// push is the one feature that stops working, and a reader has to be able
  /// to open the app on a device Firebase cannot start on.
  ///
  /// Every failure, not only a [FirebaseException]. The call crosses to the
  /// platform, which raises a `PlatformException` for a project the device
  /// rejects and a `MissingPluginException` where the plugin is not registered
  /// at all. `main` awaits this before the first frame, so anything that
  /// escaped here would leave the reader with no app rather than with no
  /// notifications.
  static Future<PushMessaging?> connect(
    FirebaseConfig? config, {
    TargetPlatform? platform,
  }) async {
    final options = config?.optionsFor(platform ?? defaultTargetPlatform);
    if (options == null) {
      return null;
    }
    try {
      await Firebase.initializeApp(options: options);
      return FirebasePushMessaging(FirebaseMessaging.instance);
    } on Object catch (error) {
      debugPrint('Firebase is unavailable, so push is off: $error');
      return null;
    }
  }

  final FirebaseMessaging _messaging;

  @override
  Future<PushAuthorization> requestAuthorization() async {
    final settings = await _messaging.requestPermission();
    switch (settings.authorizationStatus) {
      case AuthorizationStatus.authorized:
      case AuthorizationStatus.provisional:
        return PushAuthorization.granted;
      case AuthorizationStatus.denied:
      case AuthorizationStatus.deniedPermanently:
      case AuthorizationStatus.notDetermined:
        return PushAuthorization.denied;
    }
  }

  @override
  Future<String?> token() => _messaging.getToken();

  @override
  Stream<String> get tokenRefreshes => _messaging.onTokenRefresh;

  @override
  Stream<PushMessage> get foregroundMessages =>
      FirebaseMessaging.onMessage.map(_toPushMessage);

  @override
  Stream<PushMessage> get openedMessages =>
      FirebaseMessaging.onMessageOpenedApp.map(_toPushMessage);

  @override
  Future<PushMessage?> initialMessage() async {
    final message = await _messaging.getInitialMessage();
    return message == null ? null : _toPushMessage(message);
  }

  @override
  Future<void> deleteToken() => _messaging.deleteToken();
}

PushMessage _toPushMessage(RemoteMessage message) {
  return PushMessage.fromPlatform(
    title: message.notification?.title,
    body: message.notification?.body,
    data: message.data,
  );
}
