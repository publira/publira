import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:publira/push/push_device_store.dart';
import 'package:publira/push/push_message.dart';
import 'package:publira/push/push_messaging.dart';
import 'package:publira/push/push_repository.dart';

/// Why the last attempt to turn notifications on did not settle on.
enum PushFailure {
  /// The reader turned the OS prompt down, or notifications are off for the
  /// app in system settings. The switch settles back to off with a line
  /// pointing at system settings, and the app does not ask again on its own.
  denied,

  /// The device could not mint a token, or the API could not be reached. The
  /// switch goes back to off and the reader can try again.
  unavailable,
}

/// Owns the new-episode notifications the reader can turn on, and everything
/// that follows from one: the registration token on the server, the messages
/// that arrive while the app is in front, and the tap that opens an episode.
///
/// A member is told on the device when the tenant publishes a new episode, and
/// a tap opens that episode's viewer with the series behind it. The account
/// screen carries the switch for these notifications.
///
/// A build with no Firebase project has [supported] false and nothing here
/// runs, so the account screen leaves the switch out entirely.
class PushController extends ChangeNotifier {
  PushController({
    required this._messaging,
    required this._repository,
    required this._store,
    PushPlatform? platform,
  }) : _platform = platform ?? PushPlatform.current();

  final PushMessaging? _messaging;
  final PushRepository _repository;
  final PushDeviceStore _store;
  final PushPlatform? _platform;

  final _subscriptions = <StreamSubscription<Object?>>[];

  String? _token;
  String? _adopting;
  Future<void>? _adoption;

  /// Advanced whenever this install stops claiming a registration, so an
  /// adoption still in flight can tell that the reader turned notifications
  /// off or signed out under it and leave their choice standing.
  var _generation = 0;
  var _updating = false;
  PushFailure? _failure;
  PushMessage? _foregroundMessage;
  String? _pendingRoute;

  /// Whether this build can deliver notifications at all. False leaves the
  /// account screen without a switch rather than with one that cannot work.
  bool get supported => _messaging != null && _platform != null;

  /// Whether this device is registered for new-episode notifications.
  bool get enabled => _token != null;

  /// Whether a registration is in flight, which is what holds the switch.
  bool get updating => _updating;

  /// Why turning notifications on did not work, or `null` when nothing has
  /// gone wrong. It stays until the reader tries the switch again, which is
  /// what clears it.
  PushFailure? get failure => _failure;

  /// A message that arrived while the app was in front, which FCM does not
  /// draw. Read it with [acknowledgeForegroundMessage], which clears it.
  PushMessage? get foregroundMessage => _foregroundMessage;

  /// Where a tapped notification asks the app to go, or `null` when there is
  /// nothing waiting. Read it with [acknowledgePendingRoute], which clears it.
  ///
  /// An empty one is a tap on a payload naming no route the app can open,
  /// which sends the reader to the catalog.
  String? get pendingRoute => _pendingRoute;

  /// Subscribes to the device's messages and restores what this install had
  /// registered before, so a relaunch keeps the switch where the reader left
  /// it.
  ///
  /// Nothing here asks for permission: the OS prompt belongs to the first time
  /// the reader turns the switch on.
  Future<void> start() async {
    final messaging = _messaging;
    if (messaging == null || _platform == null) {
      return;
    }

    _subscriptions.add(messaging.tokenRefreshes.listen(_onTokenRefreshed));
    _subscriptions.add(
      messaging.foregroundMessages.listen((message) {
        if (!message.hasCopy) {
          return;
        }
        _foregroundMessage = message;
        notifyListeners();
      }),
    );
    _subscriptions.add(messaging.openedMessages.listen(_onMessageOpened));

    String? stored;
    try {
      stored = await _store.read();
    } on Object {
      // A credential store this launch cannot read leaves the switch off,
      // which the reader can turn back on. Failing the launch over it would
      // cost them the app rather than the notifications.
      stored = null;
    }
    if (stored != null) {
      _token = stored;
      notifyListeners();
    }

    // The tap that launched a terminated app is reported once, and only to
    // whoever asks for it, so it is read after the streams are in place.
    final initial = await messaging.initialMessage();
    if (initial != null) {
      _onMessageOpened(initial);
    }
  }

  /// Turns notifications on or off for the signed-in reader.
  ///
  /// Turning them on asks the OS the first time, so a reader who denies it
  /// sees the switch settle back to off with [failure] set to
  /// [PushFailure.denied]. Turning them off unregisters the device and stops
  /// this install's token, so a message already on its way finds nothing to
  /// deliver to.
  Future<void> setEnabled(bool value) async {
    final messaging = _messaging;
    final platform = _platform;
    if (messaging == null || platform == null || _updating) {
      return;
    }
    _updating = true;
    _failure = null;
    notifyListeners();
    try {
      if (value) {
        await _enable(messaging, platform);
      } else {
        await _disable(messaging);
      }
    } finally {
      _updating = false;
      notifyListeners();
    }
  }

  /// Re-registers the device under the reader who just signed in, so a device
  /// that was left on keeps notifying — for them, and no longer for whoever
  /// held the session before.
  ///
  /// The device is asked which identifier it is registered under now, and
  /// that one is registered rather than the one this install stored. A release
  /// before this one stored an FCM registration token, which the device no
  /// longer reports once it registers by installation ID, and an installation
  /// ID can itself be replaced while the app is not running. This runs once
  /// the session is back, which registering needs; a failure is retried the
  /// next time the app is signed in, and the reader is not told: they did not
  /// ask for anything just now.
  Future<void> handleSignedIn() async {
    final messaging = _messaging;
    final stored = _token;
    if (messaging == null || stored == null || _platform == null) {
      return;
    }
    final generation = _generation;
    final current = await messaging.token();
    // An adoption the device's report started may have gone out before the
    // session was back, so it is waited for and registered again either way.
    await _adoption;
    final held = _token;
    if (generation != _generation || held == null) {
      return;
    }
    await _adoptToken(current == null || current.isEmpty ? held : current);
  }

  /// Takes the device off the delivery list before the session goes away.
  ///
  /// The unregister needs the session, so it runs first; the token is stopped
  /// either way, which is what makes a row the API could not be told about die
  /// at the next send instead of notifying a reader who signed out.
  Future<void> handleSignOut() async {
    final token = _token;
    if (token == null) {
      return;
    }
    _generation++;
    try {
      await _repository.unregister(token);
    } on Object {
      // An unreachable API, or a session already rejected. The token below is
      // what settles it regardless.
    }
    await _stopToken();
  }

  /// Reads and clears [foregroundMessage].
  PushMessage? acknowledgeForegroundMessage() {
    final message = _foregroundMessage;
    _foregroundMessage = null;
    return message;
  }

  /// Reads and clears [pendingRoute].
  String? acknowledgePendingRoute() {
    final route = _pendingRoute;
    _pendingRoute = null;
    return route;
  }

  @override
  void dispose() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    _subscriptions.clear();
    super.dispose();
  }

  Future<void> _enable(PushMessaging messaging, PushPlatform platform) async {
    if (await messaging.requestAuthorization() == PushAuthorization.denied) {
      _failure = PushFailure.denied;
      return;
    }
    final token = await messaging.token();
    if (token == null || token.isEmpty) {
      _failure = PushFailure.unavailable;
      return;
    }
    try {
      await _repository.register(token: token, platform: platform);
    } on Object {
      _failure = PushFailure.unavailable;
      return;
    }
    try {
      await _store.write(token);
    } on Object {
      // The registration is on the server and this device cannot remember it,
      // so the switch would come back off on the next launch while the server
      // kept sending. Take the registration back and report the failure, which
      // leaves both sides saying the same thing.
      try {
        await _repository.unregister(token);
      } on Object {
        // Nothing further to try. The token is stopped below, so the row the
        // server still holds is dropped at its next send.
      }
      await _stopToken(messaging: messaging);
      _failure = PushFailure.unavailable;
      return;
    }
    _token = token;
  }

  Future<void> _disable(PushMessaging messaging) async {
    _generation++;
    final token = _token;
    if (token != null) {
      try {
        await _repository.unregister(token);
      } on Object {
        // The device stops holding the token below, so the server's row is
        // dropped at the next send even when this call could not be made.
      }
    }
    await _stopToken(messaging: messaging);
  }

  /// Forgets the token this device holds, on both sides of the platform.
  ///
  /// Nothing here throws. It runs on the way out of a sign-out and out of a
  /// failed enable, neither of which has anywhere to report a credential store
  /// that refused: what matters is that the controller stops claiming a
  /// registration, and that the token itself is stopped so a row the server
  /// still holds is dropped at its next send.
  Future<void> _stopToken({PushMessaging? messaging}) async {
    _generation++;
    try {
      await _store.clear();
    } on Object {
      // The stored value outlives this run. It names a token that is about to
      // be invalidated, so the next launch reads a registration the server
      // will drop at its first send.
    }
    _token = null;
    try {
      await (messaging ?? _messaging)?.deleteToken();
    } on Object {
      // Deleting the token is what makes an unregister the API never heard
      // about settle itself; a device that cannot do it is left to the
      // unregister that did go through.
    }
  }

  void _onTokenRefreshed(String token) {
    if (_token == null ||
        token.isEmpty ||
        token == _token ||
        token == _adopting) {
      return;
    }
    final adoption = _adoption = _adoptToken(token);
    unawaited(adoption);
  }

  /// Registers [token] on the server in place of the one this install holds,
  /// or again when it is the same one, and takes the replaced one off.
  Future<void> _adoptToken(String token) async {
    final platform = _platform;
    final previous = _token;
    if (platform == null || previous == null) {
      return;
    }
    final generation = _generation;
    _adopting = token;
    try {
      try {
        await _repository.register(token: token, platform: platform);
      } on Object {
        // The old token is kept, so the next refresh or the next sign-in
        // registers again rather than leaving the device on nothing.
        return;
      }
      if (generation != _generation) {
        await _withdraw(token);
        return;
      }
      if (token != previous) {
        try {
          await _store.write(token);
        } on Object {
          // The new token is registered and this device cannot write it down.
          // It is still the one FCM will deliver to, so it is adopted in
          // memory; a relaunch reads the old value, and the sign-in that
          // follows moves the row back to this one.
        }
        if (generation != _generation) {
          await _withdraw(token);
          return;
        }
      }
      _token = token;
      notifyListeners();
      if (token != previous) {
        try {
          await _repository.unregister(previous);
        } on Object {
          // A token FCM replaced is dropped at its next send. A registration
          // token left from before the move to installation IDs may still be
          // deliverable, so a row this call could not remove can notify the
          // device a second time.
        }
      }
    } finally {
      if (_adopting == token) {
        _adopting = null;
      }
    }
  }

  /// Takes back a registration that landed after the reader turned
  /// notifications off or signed out, whose own unregister may have reached
  /// the server first.
  Future<void> _withdraw(String token) async {
    try {
      await _repository.unregister(token);
    } on Object {
      // The install was unregistered from FCM on the way out, so the row is
      // dropped at its next send.
    }
  }

  void _onMessageOpened(PushMessage message) {
    // An empty route is a payload naming none the app can open, which is still
    // a tap: the reader is sent to the catalog rather than left where they
    // were.
    _pendingRoute = message.route;
    notifyListeners();
  }
}
