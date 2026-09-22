/// One tenant announcement, as `publira.v1.AnnouncementItem` describes it.
///
/// A reader with no session is answered the tenant-wide rows with no read
/// state, so [isRead] means something only for a signed-in reader.
class Announcement {
  const Announcement({
    required this.id,
    required this.title,
    this.body = '',
    this.linkUrl = '',
    this.isRead = false,
    this.createdAt,
    this.pinnedUntil,
  });

  final String id;
  final String title;
  final String body;

  /// Where the operator pointed the announcement, as they wrote it: a path on
  /// the tenant site or an absolute URL. Empty when they wrote none.
  final String linkUrl;
  final bool isRead;

  /// When it was posted, and `null` when the API sent a timestamp this build
  /// could not read.
  final DateTime? createdAt;

  /// When a pinned announcement's banner stops, and `null` when it stays up
  /// until the console takes it down.
  final DateTime? pinnedUntil;

  /// Whether the banner of this pinned announcement is still up at [now].
  bool isPinnedAt(DateTime now) {
    final until = pinnedUntil;
    return until == null || now.isBefore(until);
  }

  Announcement markedRead() => Announcement(
    id: id,
    title: title,
    body: body,
    linkUrl: linkUrl,
    isRead: true,
    createdAt: createdAt,
    pinnedUntil: pinnedUntil,
  );
}

/// One page of the announcements, newest first, as
/// `ListAnnouncementsResponse` answers it.
///
/// [nextToken] is opaque, and an empty one is the end. The list only ever
/// walks forward, so the response's `previous_token` is left behind.
class AnnouncementPage {
  const AnnouncementPage({required this.announcements, this.nextToken = ''});

  final List<Announcement> announcements;
  final String nextToken;
}
