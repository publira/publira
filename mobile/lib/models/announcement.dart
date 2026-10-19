import 'dart:ui';

import 'package:publira/l10n/locale_negotiation.dart';

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
    this.locale = '',
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

  /// The locale [title] and [body] were answered in, which differs from the
  /// one asked for when the announcement was not written in it. Empty when
  /// the API named none.
  final String locale;

  /// [locale] as a text widget takes it, or `null` for one no catalog
  /// carries, which leaves the app's own.
  Locale? get textLocale => supportedLocaleForCode(locale);

  /// The name of the language the announcement is shown in, when that is not
  /// [requested], or `null` when it is in the language asked for.
  String? fallbackLanguage(Locale requested) =>
      fallbackLanguageLabel(locale, requested);

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
    locale: locale,
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
