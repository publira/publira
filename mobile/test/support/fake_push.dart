import 'dart:async';

import 'package:publira/push/push_device_store.dart';
import 'package:publira/push/push_message.dart';
import 'package:publira/push/push_messaging.dart';
import 'package:publira/push/push_repository.dart';

/// A device whose answers a test writes, so the notification behaviour can be
/// driven without Firebase.
class FakePushMessaging implements PushMessaging {
  FakePushMessaging({
    this.authorization = PushAuthorization.granted,
    this.currentToken = 'device-token',
    this.launchMessage,
  });

  PushAuthorization authorization;
  String? currentToken;

  /// The tap that started a terminated app, which [initialMessage] reports
  /// once.
  PushMessage? launchMessage;

  var authorizationRequests = 0;
  var deletedTokens = 0;

  final tokenRefreshController = StreamController<String>.broadcast();
  final foregroundController = StreamController<PushMessage>.broadcast();
  final openedController = StreamController<PushMessage>.broadcast();

  Future<void> close() async {
    await tokenRefreshController.close();
    await foregroundController.close();
    await openedController.close();
  }

  @override
  Future<PushAuthorization> requestAuthorization() async {
    authorizationRequests++;
    return authorization;
  }

  @override
  Future<String?> token() async => currentToken;

  @override
  Stream<String> get tokenRefreshes => tokenRefreshController.stream;

  @override
  Stream<PushMessage> get foregroundMessages => foregroundController.stream;

  @override
  Stream<PushMessage> get openedMessages => openedController.stream;

  @override
  Future<PushMessage?> initialMessage() async {
    final message = launchMessage;
    launchMessage = null;
    return message;
  }

  @override
  Future<void> deleteToken() async {
    deletedTokens++;
    currentToken = null;
  }
}

/// The API half, recording what the controller asked it to do.
class FakePushRepository implements PushRepository {
  final registered = <String>[];
  final unregistered = <String>[];
  PushPlatform? lastPlatform;

  /// Thrown by every call of either method until a test clears it, which is
  /// how an unreachable API is acted out. Set it to `null` between calls to
  /// act out one that recovers.
  Object? failure;

  @override
  Future<void> register({
    required String token,
    required PushPlatform platform,
  }) async {
    final error = failure;
    if (error != null) {
      throw error;
    }
    lastPlatform = platform;
    registered.add(token);
  }

  @override
  Future<void> unregister(String token) async {
    final error = failure;
    if (error != null) {
      throw error;
    }
    unregistered.add(token);
  }
}

/// A [PushDeviceStore] that keeps the token in memory, so a test does not
/// reach the platform keychain.
class InMemoryPushDeviceStore implements PushDeviceStore {
  InMemoryPushDeviceStore({this.token, this.readError, this.writeError});

  String? token;

  /// Thrown by [read] and [write], standing in for a credential store the
  /// platform refuses.
  Object? readError;
  Object? writeError;

  @override
  Future<String?> read() async {
    final error = readError;
    if (error != null) {
      throw error;
    }
    return token;
  }

  @override
  Future<void> write(String token) async {
    final error = writeError;
    if (error != null) {
      throw error;
    }
    this.token = token;
  }

  @override
  Future<void> clear() async {
    token = null;
  }
}
