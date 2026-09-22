import 'dart:async';

import 'package:publira/announcements/announcement_failure.dart';
import 'package:publira/announcements/announcement_repository.dart';
import 'package:publira/models/announcement.dart';

/// [AnnouncementRepository] that answers from what a test sets on it, the way
/// the API would: the read marks write to the rows, and the next read sees
/// them.
class FakeAnnouncementRepository implements AnnouncementRepository {
  FakeAnnouncementRepository({
    List<Announcement> announcements = const [],
    this.pageSize = 0,
    this.pinnedId,
    this.listFailure,
    this.getFailure,
    this.pinnedFailure,
    this.markFailure,
  }) : announcements = List.of(announcements);

  /// Every announcement of the tenant, newest first.
  List<Announcement> announcements;

  /// How many rows one page holds. The token of a page is the index of its
  /// first row, written out. `0` answers every row at once.
  int pageSize;

  /// The id among [announcements] that [pinned] answers.
  String? pinnedId;

  AnnouncementFailure? listFailure;
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
  final fetched = <String>[];
  final marked = <String>[];
  var markAllCalls = 0;
  var pinnedReads = 0;

  @override
  Future<AnnouncementPage> list({String token = ''}) async {
    listTokens.add(token);
    final failure = listFailure;
    if (failure != null) {
      throw failure;
    }
    final AnnouncementPage page;
    if (pageSize <= 0) {
      page = AnnouncementPage(announcements: List.of(announcements));
    } else {
      final start = token.isEmpty ? 0 : int.parse(token);
      final end = (start + pageSize).clamp(0, announcements.length);
      page = AnnouncementPage(
        announcements: announcements.sublist(start, end),
        nextToken: end < announcements.length ? '$end' : '',
      );
    }
    await listGate?.future;
    return page;
  }

  @override
  Future<Announcement> get(String announcementId) async {
    fetched.add(announcementId);
    final failure = getFailure;
    if (failure != null) {
      throw failure;
    }
    for (final row in announcements) {
      if (row.id == announcementId) {
        return row;
      }
    }
    throw const AnnouncementFailure(AnnouncementFailureKind.notFound);
  }

  @override
  Future<Announcement?> pinned() async {
    pinnedReads++;
    final failure = pinnedFailure;
    if (failure != null) {
      throw failure;
    }
    for (final row in announcements) {
      if (row.id == pinnedId) {
        return row;
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
}
