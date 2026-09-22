import 'package:publira/models/announcement.dart';

/// The announcement half of `publira.v1.AuthService`.
///
/// Every call reaches the API: read state is shared with the site, so a
/// device that answered on its own would show marks the next screen
/// contradicts. The reads take no session, because an announcement is the
/// tenant's word to everyone who opens the app; a session only adds read
/// state.
abstract class AnnouncementRepository {
  /// One page of the announcements, newest first.
  ///
  /// [token] is the opaque cursor from a previous page, empty for the first
  /// one. Throws [AnnouncementFailure].
  Future<AnnouncementPage> list({String token});

  /// The announcement [announcementId]. Throws [AnnouncementFailure].
  Future<Announcement> get(String announcementId);

  /// The announcement the tenant has pinned right now, or `null` when it has
  /// none. Throws [AnnouncementFailure].
  Future<Announcement?> pinned();

  /// Marks [announcementId] read. Throws [AnnouncementFailure].
  Future<void> markRead(String announcementId);

  /// Marks every announcement read. Throws [AnnouncementFailure].
  Future<void> markAllRead();
}
