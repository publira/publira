import 'package:flutter/widgets.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/inbox_notification.dart';
import 'package:publira/notifications/notification_failure.dart';
import 'package:publira/notifications/notification_repository.dart';

/// The signed-in reader's inbox, and the unread count every screen badges.
///
/// The count is never worked out on the device: it is read back from the API
/// after every read mark and whenever the inbox opens, so it agrees with the
/// server whatever the pages on screen hold and whatever another device marked.
class NotificationInbox extends ChangeNotifier {
  NotificationInbox({required this._repository});

  final NotificationRepository _repository;

  var _unreadCount = 0;

  /// Counts the count reads started and the resets, so an answer meant for the
  /// reader before a sign-out cannot land on the badge.
  var _reads = 0;

  int get unreadCount => _unreadCount;

  /// Reads the unread count again.
  ///
  /// The badge is chrome, so a failure keeps the count it had rather than
  /// failing anything; only a session the API no longer takes clears it.
  Future<void> refresh() async {
    final read = ++_reads;
    int count;
    try {
      count = await _repository.countUnread();
    } on NotificationFailure catch (failure) {
      if (failure.kind != NotificationFailureKind.sessionExpired) {
        return;
      }
      count = 0;
    }
    if (read != _reads || count == _unreadCount) {
      return;
    }
    _unreadCount = count;
    notifyListeners();
  }

  /// Drops the count of a reader who signed out.
  void reset() {
    _reads++;
    if (_unreadCount == 0) {
      return;
    }
    _unreadCount = 0;
    notifyListeners();
  }

  /// One page of the inbox. Throws [NotificationFailure].
  Future<InboxNotificationPage> list({String token = ''}) =>
      _repository.list(token: token);

  /// Marks [notificationId] read, then reads the count back. Throws
  /// [NotificationFailure].
  Future<void> markRead(String notificationId) async {
    await _repository.markRead(notificationId);
    await refresh();
  }

  /// Marks every notification read, then reads the count back. Throws
  /// [NotificationFailure].
  Future<void> markAllRead() async {
    await _repository.markAllRead();
    await refresh();
  }
}

/// Looks up the app's [NotificationInbox] and rebuilds its dependents when the
/// unread count changes.
///
/// It is absent in a widget test that builds the app without one, so [maybeOf]
/// answers `null` rather than asserting: no screen then leads to an inbox.
class NotificationScope extends InheritedNotifier<NotificationInbox> {
  const NotificationScope({
    super.key,
    NotificationInbox? inbox,
    required super.child,
  }) : super(notifier: inbox);

  static NotificationInbox? maybeOf(BuildContext context) {
    final scope = context
        .dependOnInheritedWidgetOfExactType<NotificationScope>();
    return scope?.notifier;
  }
}

/// What a badge shows for [count] unread notifications: the number, capped
/// where it would no longer fit the badge.
String unreadBadgeLabel(AppMessages messages, int count) => count > 99
    ? '${messages.formatInteger(99)}+'
    : messages.formatInteger(count);
