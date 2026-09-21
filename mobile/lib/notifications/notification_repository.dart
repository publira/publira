import 'package:publira/models/inbox_notification.dart';

/// The inbox half of `publira.v1.NotificationService`.
///
/// Every call reaches the API: the inbox is one list the reader shares with
/// the site, so a device that answered it on its own would show read states
/// the next screen contradicts. A reader who is signed out has no inbox, and
/// the reads answer so without a request.
abstract class NotificationRepository {
  /// One page of the signed-in reader's notifications, newest first.
  ///
  /// [token] is the opaque cursor from a previous page, empty for the first
  /// one. Throws [NotificationFailure].
  Future<InboxNotificationPage> list({String token});

  /// How many of the reader's notifications are unread. Throws
  /// [NotificationFailure].
  Future<int> countUnread();

  /// Marks [notificationId] read. Marking a read one again is the same as
  /// marking it once. Throws [NotificationFailure].
  Future<void> markRead(String notificationId);

  /// Marks every notification of the reader read. Throws
  /// [NotificationFailure].
  Future<void> markAllRead();
}
