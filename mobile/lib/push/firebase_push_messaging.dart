import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:publira/push/firebase_config.dart';
import 'package:publira/push/push_message.dart';
import 'package:publira/push/push_messaging.dart';

/// [PushMessaging] backed by Firebase Cloud Messaging.
///
/// The server sends every message through FCM, which relays to APNs for iOS,
/// so one integration carries both platforms.
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

  /// Registers this install with FCM and answers the Firebase Installation ID
  /// it is registered under, or `null` when the device could not register.
  ///
  /// [FirebaseMessaging.register] completes without the ID, which both
  /// platforms deliver on [FirebaseMessaging.onRegistered] instead, also when
  /// the install was registered already. The listener therefore goes on before
  /// the call, and the wait after it is bounded so that a callback that never
  /// comes leaves the switch off rather than holding it forever.
  @override
  Future<String?> token() async {
    final registered = _messaging.onRegistered.first;
    try {
      await _messaging.register();
      return await registered.timeout(_registrationTimeout);
    } on Object catch (error) {
      registered.ignore();
      debugPrint('FCM registration failed: $error');
      return null;
    }
  }

  @override
  Stream<String> get tokenRefreshes => _messaging.onRegistered;

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
  Future<void> deleteToken() => _messaging.unregister();
}

/// How long [FirebasePushMessaging.token] waits for the ID once registration
/// has completed, by which point the callback is already on its way.
const _registrationTimeout = Duration(seconds: 10);

PushMessage _toPushMessage(RemoteMessage message) {
  return PushMessage.fromPlatform(
    title: message.notification?.title,
    body: message.notification?.body,
    data: message.data,
  );
}
