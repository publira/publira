/// @docImport 'package:publira/announcements/announcement_failure.dart';
library;

import 'package:publira/models/announcement.dart';

/// The announcement half of `publira.v1.AuthService`.
///
/// Every call reaches the API: read state is shared with the site, so a
/// device that answered on its own would show marks the next screen
/// contradicts. A visitor reads every announcement addressed to everyone. A
/// session adds read state, and the announcements with conditions that were
/// delivered to that reader, which the API answers to nobody else.
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

  /// The announcement [announcementId]. Throws [AnnouncementFailure], whose
  /// kind is [AnnouncementFailureKind.notFound] for one with conditions that
  /// was not delivered to the reader asking.
  Future<Announcement> get(String announcementId, {required String locale});

  /// The announcement the tenant has pinned right now, or `null` when it has
  /// none. Throws [AnnouncementFailure].
  Future<Announcement?> pinned({required String locale});

  /// Marks [announcementId] read. Throws [AnnouncementFailure].
  Future<void> markRead(String announcementId);

  /// Marks every announcement read. Throws [AnnouncementFailure].
  Future<void> markAllRead();
}
