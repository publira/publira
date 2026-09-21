import 'dart:convert';

/// The `notification_type` values the inbox has copy for.
enum InboxNotificationKind {
  episodePublished('episode_published'),
  commentApproved('comment_approved'),
  commentHidden('comment_hidden'),
  announcementPosted('announcement_posted'),

  /// A type this build has no copy for, which still stays in the list as a
  /// generic row: the reader was notified of something, and the row is where
  /// they mark it read.
  unknown('');

  const InboxNotificationKind(this.wireValue);

  final String wireValue;

  static InboxNotificationKind fromWire(String raw) {
    final type = raw.trim();
    for (final kind in values) {
      if (kind != unknown && kind.wireValue == type) {
        return kind;
      }
    }
    return unknown;
  }
}

/// Who took a reader's comment down, as `comment_hidden` carries it.
enum CommentHiddenReason {
  staff('staff'),
  autoReports('auto_reports');

  const CommentHiddenReason(this.wireValue);

  final String wireValue;

  static CommentHiddenReason? fromWire(Object? raw) {
    for (final reason in values) {
      if (reason.wireValue == raw) {
        return reason;
      }
    }
    return null;
  }
}

/// The fields of a notification's JSON payload the inbox reads.
///
/// The payload arrives over the network, so every field is checked on its
/// own: a bad one reads as absent and leaves the rest usable, and a payload
/// that is not a JSON object reads as empty.
class InboxNotificationPayload {
  const InboxNotificationPayload({
    this.seriesId,
    this.episodeId,
    this.seriesTitle,
    this.episodeTitle,
    this.announcementTitle,
    this.hiddenReason,
  });

  factory InboxNotificationPayload.parse(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) {
      return empty;
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(trimmed);
    } on FormatException {
      return empty;
    }
    if (decoded is! Map) {
      return empty;
    }
    return InboxNotificationPayload(
      seriesId: _publicId(decoded['series_id']),
      episodeId: _publicId(decoded['episode_id']),
      seriesTitle: _label(decoded['series_title']),
      episodeTitle: _label(decoded['episode_title']),
      announcementTitle: _label(decoded['announcement_title']),
      hiddenReason: CommentHiddenReason.fromWire(decoded['hidden_reason']),
    );
  }

  static const empty = InboxNotificationPayload();

  /// A public id is placed in a route path, so anything but the characters
  /// one is made of is dropped rather than allowed to reshape the path.
  static final _publicIdPattern = RegExp(r'^[A-Za-z0-9_-]{1,64}$');

  static String? _publicId(Object? value) {
    if (value is! String) {
      return null;
    }
    final trimmed = value.trim();
    return _publicIdPattern.hasMatch(trimmed) ? trimmed : null;
  }

  static String? _label(Object? value) {
    if (value is! String) {
      return null;
    }
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  final String? seriesId;
  final String? episodeId;
  final String? seriesTitle;
  final String? episodeTitle;
  final String? announcementTitle;
  final CommentHiddenReason? hiddenReason;
}

/// One row of the signed-in reader's inbox, as `publira.v1.NotificationItem`
/// describes it.
class InboxNotification {
  const InboxNotification({
    required this.id,
    required this.kind,
    this.payload = InboxNotificationPayload.empty,
    this.isRead = false,
    this.createdAt,
  });

  final String id;
  final InboxNotificationKind kind;
  final InboxNotificationPayload payload;
  final bool isRead;

  /// When the notification was made, and `null` when the API sent a timestamp
  /// this build could not read.
  final DateTime? createdAt;

  InboxNotification markedRead() => InboxNotification(
    id: id,
    kind: kind,
    payload: payload,
    isRead: true,
    createdAt: createdAt,
  );
}

/// One page of the inbox, newest first, as `ListNotificationsResponse`
/// answers it.
///
/// [nextToken] is opaque, and an empty one is the end. The list only ever
/// walks forward, so the response's `previous_token` is left behind.
class InboxNotificationPage {
  const InboxNotificationPage({
    required this.notifications,
    this.nextToken = '',
  });

  /// A reader with no notifications, which is also what a guest is answered.
  static const empty = InboxNotificationPage(notifications: []);

  final List<InboxNotification> notifications;
  final String nextToken;
}
