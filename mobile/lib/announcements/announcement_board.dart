import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:publira/announcements/announcement_failure.dart';
import 'package:publira/announcements/announcement_repository.dart';
import 'package:publira/announcements/dismissed_announcement_store.dart';
import 'package:publira/models/announcement.dart';

/// The tenant's announcements, and the pinned one the catalog shows as a
/// banner.
class AnnouncementBoard extends ChangeNotifier {
  AnnouncementBoard({
    required this._repository,
    DismissedAnnouncementStore? dismissed,
    DateTime Function()? now,
  }) : _dismissed = dismissed ?? MemoryDismissedAnnouncementStore(),
       _now = now ?? DateTime.now;

  final AnnouncementRepository _repository;
  final DismissedAnnouncementStore _dismissed;
  final DateTime Function() _now;

  Announcement? _pinned;
  var _dismissedId = '';

  /// Counts the pinned reads started, so a slow answer cannot replace a newer
  /// one.
  var _pinnedReads = 0;

  /// Takes the banner down when its window closes while it is on screen.
  Timer? _expiry;

  /// The banner to show: the pinned announcement, unless the reader closed it
  /// or its window has closed since it was read.
  Announcement? get banner {
    final pinned = _pinned;
    if (pinned == null ||
        pinned.id == _dismissedId ||
        !pinned.isPinnedAt(_now())) {
      return null;
    }
    return pinned;
  }

  /// Brings back the banner the reader closed on an earlier run. A store that
  /// cannot be read leaves every banner open.
  Future<void> restore() async {
    try {
      _dismissedId = await _dismissed.read();
    } on Object {
      _dismissedId = '';
    }
    notifyListeners();
  }

  /// Reads the pinned announcement again.
  ///
  /// The banner is an addition to the screen rather than part of it, so a
  /// read that fails shows none rather than an apology.
  Future<void> refreshPinned() async {
    final read = ++_pinnedReads;
    Announcement? pinned;
    try {
      pinned = await _repository.pinned();
    } on AnnouncementFailure {
      pinned = null;
    }
    if (read != _pinnedReads) {
      return;
    }
    _pinned = pinned;
    _scheduleExpiry();
    notifyListeners();
  }

  /// Closes the banner of [announcementId] on this device. The announcement
  /// itself stays in the list, unread if it was.
  Future<void> dismiss(String announcementId) async {
    _dismissedId = announcementId;
    notifyListeners();
    try {
      await _dismissed.write(announcementId);
    } on Object {
      // Closed for this run; a store that refuses the write cannot keep a
      // banner the reader closed on screen.
    }
  }

  /// One page of the announcements. Throws [AnnouncementFailure].
  Future<AnnouncementPage> list({String token = ''}) =>
      _repository.list(token: token);

  /// The announcement [announcementId]. Throws [AnnouncementFailure].
  Future<Announcement> get(String announcementId) =>
      _repository.get(announcementId);

  /// Throws [AnnouncementFailure].
  Future<void> markRead(String announcementId) =>
      _repository.markRead(announcementId);

  /// Throws [AnnouncementFailure].
  Future<void> markAllRead() => _repository.markAllRead();

  void _scheduleExpiry() {
    _expiry?.cancel();
    _expiry = null;
    final until = _pinned?.pinnedUntil;
    if (until == null) {
      return;
    }
    final remaining = until.difference(_now());
    if (remaining.isNegative) {
      return;
    }
    _expiry = Timer(remaining, notifyListeners);
  }

  @override
  void dispose() {
    _expiry?.cancel();
    super.dispose();
  }
}

/// Looks up the app's [AnnouncementBoard] and rebuilds its dependents when
/// the banner changes.
///
/// It is absent in a widget test that builds the app without one, so
/// [maybeOf] answers `null` rather than asserting: no screen then shows a
/// banner or leads to the announcements.
class AnnouncementScope extends InheritedNotifier<AnnouncementBoard> {
  const AnnouncementScope({
    super.key,
    AnnouncementBoard? board,
    required super.child,
  }) : super(notifier: board);

  static AnnouncementBoard? maybeOf(BuildContext context) {
    final scope = context
        .dependOnInheritedWidgetOfExactType<AnnouncementScope>();
    return scope?.notifier;
  }
}
