import 'dart:async';

import 'package:publira/models/inbox_notification.dart';
import 'package:publira/notifications/notification_failure.dart';
import 'package:publira/notifications/notification_repository.dart';

/// [NotificationRepository] that answers from what a test sets on it, the way
/// the API would: the count is worked out from the rows, and the read marks
/// write to them.
class FakeNotificationRepository implements NotificationRepository {
  FakeNotificationRepository({
    List<InboxNotification> notifications = const [],
    this.pageSize = 0,
    this.listFailure,
    this.countFailure,
    this.markFailure,
  }) : notifications = List.of(notifications);

  /// Every notification of the reader, newest first.
  List<InboxNotification> notifications;

  /// How many rows one page holds. The token of a page is the index of its
  /// first row, written out. `0` answers every row at once.
  int pageSize;

  NotificationFailure? listFailure;
  NotificationFailure? countFailure;
  NotificationFailure? markFailure;

  /// Holds [markRead] and [markAllRead] until a test completes it, so a test
  /// can change what happens while a mark is in flight.
  Completer<void>? markGate;

  /// What was asked for, in order, so a test can assert what the screen sent.
  final listTokens = <String>[];
  final marked = <String>[];
  var markAllCalls = 0;
  var countReads = 0;

  int get unreadCount => notifications.where((row) => !row.isRead).length;

  @override
  Future<InboxNotificationPage> list({String token = ''}) async {
    listTokens.add(token);
    final failure = listFailure;
    if (failure != null) {
      throw failure;
    }
    if (pageSize <= 0) {
      return InboxNotificationPage(notifications: List.of(notifications));
    }
    final start = token.isEmpty ? 0 : int.parse(token);
    final end = (start + pageSize).clamp(0, notifications.length);
    return InboxNotificationPage(
      notifications: notifications.sublist(start, end),
      nextToken: end < notifications.length ? '$end' : '',
    );
  }

  @override
  Future<int> countUnread() async {
    countReads++;
    final failure = countFailure;
    if (failure != null) {
      throw failure;
    }
    return unreadCount;
  }

  @override
  Future<void> markRead(String notificationId) async {
    marked.add(notificationId);
    await markGate?.future;
    final failure = markFailure;
    if (failure != null) {
      throw failure;
    }
    notifications = [
      for (final row in notifications)
        row.id == notificationId ? row.markedRead() : row,
    ];
  }

  @override
  Future<void> markAllRead() async {
    markAllCalls++;
    await markGate?.future;
    final failure = markFailure;
    if (failure != null) {
      throw failure;
    }
    notifications = [for (final row in notifications) row.markedRead()];
  }
}
