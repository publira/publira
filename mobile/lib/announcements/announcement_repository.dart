import 'package:publira/models/announcement.dart';

/// The announcement half of `publira.v1.AuthService`.
///
/// Every call reaches the API: read state is shared with the site, so a
/// device that answered on its own would show marks the next screen
/// contradicts. The reads take no session, because an announcement is the
/// tenant's word to everyone who opens the app; a session only adds read
/// state.
///
/// Each read is answered in the announcement's translation in its `locale`,
/// else the tenant's default locale, else its oldest, and
/// [Announcement.locale] names which. A signed-in read is also what tells the
/// API the language to write the reader's notifications in.
abstract class AnnouncementRepository {
  /// One page of the announcements, newest first.
  ///
  /// [token] is the opaque cursor from a previous page, empty for the first
  /// one. Throws [AnnouncementFailure].
  Future<AnnouncementPage> list({String token, required String locale});

  /// The announcement [announcementId]. Throws [AnnouncementFailure].
  Future<Announcement> get(String announcementId, {required String locale});

  /// The announcement the tenant has pinned right now, or `null` when it has
  /// none. Throws [AnnouncementFailure].
  Future<Announcement?> pinned({required String locale});

  /// Marks [announcementId] read. Throws [AnnouncementFailure].
  Future<void> markRead(String announcementId);

  /// Marks every announcement read. Throws [AnnouncementFailure].
  Future<void> markAllRead();
}
