import 'dart:async';

import 'package:publira/announcements/announcement_failure.dart';
import 'package:publira/announcements/announcement_repository.dart';
import 'package:publira/models/announcement.dart';

/// [AnnouncementRepository] that answers from what a test sets on it, the way
/// the API would: the read marks write to the rows, and the next read sees
/// them, and a read in a locale [translations] has a row's copy in answers
/// that copy.
class FakeAnnouncementRepository implements AnnouncementRepository {
  FakeAnnouncementRepository({
    List<Announcement> announcements = const [],
    this.pageSize = 0,
    this.pinnedId,
    this.listFailure,
    this.getFailure,
    this.pinnedFailure,
    this.markFailure,
    this.translations = const {},
  }) : announcements = List.of(announcements);

  /// Every announcement of the tenant, newest first, each in the copy a read
  /// in a locale [translations] has nothing for answers.
  List<Announcement> announcements;

  /// The title and body of an announcement per locale, by id: what a read in
  /// that locale answers in place of the row's own copy.
  Map<String, Map<String, ({String title, String body})>> translations;

  /// How many rows one page holds. The token of a page is the index of its
  /// first row, written out. `0` answers every row at once.
  int pageSize;

  /// The id among [announcements] that [pinned] answers.
  String? pinnedId;

  AnnouncementFailure? listFailure;

  /// Thrown by [list] for every page but the first.
  AnnouncementFailure? moreFailure;

  AnnouncementFailure? getFailure;
  AnnouncementFailure? pinnedFailure;
  AnnouncementFailure? markFailure;

  /// Holds [list] until a test completes it, so a test can land a mark while
  /// a page is in flight. The page is taken when the request is made, as the
  /// API answers from the rows it held then.
  Completer<void>? listGate;

  /// Holds [markRead] and [markAllRead] until a test completes it.
  Completer<void>? markGate;

  /// What was asked for, in order, so a test can assert what the screen sent.
  final listTokens = <String>[];
  final listLocales = <String>[];
  final fetched = <String>[];
  final getLocales = <String>[];
  final pinnedLocales = <String>[];
  final marked = <String>[];
  var markAllCalls = 0;
  var pinnedReads = 0;

  @override
  Future<AnnouncementPage> list({
    String token = '',
    required String locale,
  }) async {
    listTokens.add(token);
    listLocales.add(locale);
    final failure = listFailure;
    if (failure != null) {
      throw failure;
    }
    final more = moreFailure;
    if (more != null && token.isNotEmpty) {
      throw more;
    }
    final AnnouncementPage page;
    if (pageSize <= 0) {
      page = AnnouncementPage(
        announcements: [for (final row in announcements) _in(row, locale)],
      );
    } else {
      final start = token.isEmpty ? 0 : int.parse(token);
      final end = (start + pageSize).clamp(0, announcements.length);
      page = AnnouncementPage(
        announcements: [
          for (final row in announcements.sublist(start, end)) _in(row, locale),
        ],
        nextToken: end < announcements.length ? '$end' : '',
      );
    }
    await listGate?.future;
    return page;
  }

  @override
  Future<Announcement> get(
    String announcementId, {
    required String locale,
  }) async {
    fetched.add(announcementId);
    getLocales.add(locale);
    final failure = getFailure;
    if (failure != null) {
      throw failure;
    }
    for (final row in announcements) {
      if (row.id == announcementId) {
        return _in(row, locale);
      }
    }
    throw const AnnouncementFailure(AnnouncementFailureKind.notFound);
  }

  @override
  Future<Announcement?> pinned({required String locale}) async {
    pinnedReads++;
    pinnedLocales.add(locale);
    final failure = pinnedFailure;
    if (failure != null) {
      throw failure;
    }
    for (final row in announcements) {
      if (row.id == pinnedId) {
        return _in(row, locale);
      }
    }
    return null;
  }

  @override
  Future<void> markRead(String announcementId) async {
    marked.add(announcementId);
    await markGate?.future;
    final failure = markFailure;
    if (failure != null) {
      throw failure;
    }
    if (!announcements.any((row) => row.id == announcementId)) {
      throw const AnnouncementFailure(AnnouncementFailureKind.notFound);
    }
    announcements = [
      for (final row in announcements)
        row.id == announcementId ? row.markedRead() : row,
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
    announcements = [for (final row in announcements) row.markedRead()];
  }

  /// [row] with the copy [translations] has for it in [locale], or as it is
  /// where there is none, which is the fallback the API answers.
  Announcement _in(Announcement row, String locale) {
    final copy = translations[row.id]?[locale];
    if (copy == null) {
      return row;
    }
    return Announcement(
      id: row.id,
      title: copy.title,
      body: copy.body,
      linkUrl: row.linkUrl,
      isRead: row.isRead,
      createdAt: row.createdAt,
      pinnedUntil: row.pinnedUntil,
      locale: locale,
    );
  }
}
