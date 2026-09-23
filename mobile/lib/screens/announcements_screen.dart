import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/announcements/announcement_board.dart';
import 'package:publira/announcements/announcement_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/announcement.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/announcement_screen.dart';

/// How many rows before the end of the list the page under it is asked for,
/// the same read-ahead the other paged lists use.
const _readAheadRows = 5;

/// The tenant's announcements, newest first.
///
/// A visitor reads the same list as a signed-in reader. What a session adds
/// is read state: the unread marks, and the controls that set them.
class AnnouncementsScreen extends StatefulWidget {
  const AnnouncementsScreen({super.key});

  @override
  State<AnnouncementsScreen> createState() => _AnnouncementsScreenState();
}

class _AnnouncementsScreenState extends State<AnnouncementsScreen> {
  /// Every page read so far as one list, and `null` while the first is still
  /// in flight.
  List<Announcement>? _announcements;

  /// What the API calls the page under [_announcements]. Empty at the end of
  /// the list, which is what takes the footer away.
  var _nextToken = '';

  /// The first page's failure, which is the whole screen, and a later page's,
  /// which is the footer under the rows already on screen.
  AnnouncementFailure? _failure;
  AnnouncementFailure? _moreFailure;

  /// Whether a page is in flight. The screen is not built from it, so it is
  /// set without [setState], which is what lets the list ask for a page while
  /// it builds.
  var _reading = false;

  /// The token of the page in flight, so a page asked for before a mark-all
  /// landed can be asked for again.
  var _readingToken = '';

  /// What this reader marked read here. A page asked for before a mark landed
  /// still carries the row unread, and read state never goes back, so every
  /// page is laid over it.
  final _markedIds = <String>{};

  /// Counts the reads this screen has started, so an answer meant for the
  /// reader before this one cannot land on the list.
  var _reads = 0;

  /// Completes the pull to refresh once the first page is back.
  Completer<void>? _refreshing;

  var _markingAll = false;
  var _accessToken = '';
  var _started = false;

  /// Reads the list again whenever the reader changes: read state belongs to
  /// whoever holds the session.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final accessToken = AuthScope.of(context).accessToken;
    if (_started && accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _markedIds.clear();
    _readFirstPage();
  }

  @override
  void dispose() {
    _refreshing?.complete();
    super.dispose();
  }

  void _readFirstPage() {
    setState(() {
      _markingAll = false;
      _announcements = null;
      _nextToken = '';
      _failure = null;
      _moreFailure = null;
      _reading = true;
      _readingToken = '';
    });
    unawaited(_read(++_reads, ''));
  }

  Future<void> _refresh() {
    final pending = Completer<void>();
    _refreshing?.complete();
    _refreshing = pending;
    _readFirstPage();
    return pending.future;
  }

  /// Asks for the page under the last one, unless it is already on its way,
  /// the list ended, or the last attempt at it failed and is waiting on the
  /// footer's retry.
  void _readMore() {
    if (_reading || _nextToken.isEmpty || _moreFailure != null) {
      return;
    }
    _reading = true;
    _readingToken = _nextToken;
    unawaited(_read(++_reads, _nextToken));
  }

  Future<void> _read(int read, String token) async {
    final board = AnnouncementScope.maybeOf(context);
    if (board == null) {
      return;
    }
    final isFirstPage = token.isEmpty;
    AnnouncementPage? page;
    AnnouncementFailure? failure;
    try {
      page = await board.list(token: token);
    } on AnnouncementFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    if (isFirstPage) {
      _refreshing?.complete();
      _refreshing = null;
    }
    setState(() {
      _reading = false;
      if (page == null) {
        // A session the API refuses is refused for every page, so it takes the
        // whole screen, where the way out is to sign in again.
        if (isFirstPage ||
            failure?.kind == AnnouncementFailureKind.sessionExpired) {
          _failure = failure;
        } else {
          _moreFailure = failure;
        }
        return;
      }
      _announcements = [
        if (!isFirstPage) ...?_announcements,
        for (final row in page.announcements)
          _markedIds.contains(row.id) ? row.markedRead() : row,
      ];
      _nextToken = page.nextToken;
    });
  }

  /// Marks [announcement] read on the API, and on the row once it has been.
  ///
  /// The answer is dropped when another reader holds the session by then:
  /// it was about the rows of the reader who asked.
  Future<void> _markRead(Announcement announcement) async {
    final board = AnnouncementScope.maybeOf(context);
    if (board == null) {
      return;
    }
    final auth = AuthScope.of(context);
    final accessToken = _accessToken;
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await board.markRead(announcement.id);
    } on AnnouncementFailure catch (failure) {
      if (auth.accessToken != accessToken) {
        return;
      }
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            announcementFailureCopy(
              messages,
              failure,
              messages.announcementsMarkReadFailed,
            ),
          ),
        ),
      );
      return;
    }
    if (!mounted || accessToken != _accessToken) {
      return;
    }
    _markedIds.add(announcement.id);
    final announcements = _announcements;
    // A first page still in flight lays the mark over its rows when it lands.
    if (announcements == null) {
      return;
    }
    setState(() {
      _announcements = [
        for (final row in announcements)
          row.id == announcement.id ? row.markedRead() : row,
      ];
    });
  }

  Future<void> _markAllRead() async {
    final board = AnnouncementScope.maybeOf(context);
    if (board == null) {
      return;
    }
    final accessToken = _accessToken;
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _markingAll = true;
    });
    AnnouncementFailure? failure;
    try {
      await board.markAllRead();
    } on AnnouncementFailure catch (error) {
      failure = error;
    }
    // Another reader's rows were read since, and the session change has
    // already put the button back.
    if (!mounted || accessToken != _accessToken) {
      return;
    }
    final announcements = _announcements;
    setState(() {
      _markingAll = false;
      if (failure == null && announcements != null) {
        _markedIds.addAll([for (final row in announcements) row.id]);
        _announcements = [for (final row in announcements) row.markedRead()];
      }
    });
    // A page asked for before the mark landed holds rows it does not cover,
    // unread as they were, so that page is asked for again.
    if (failure == null && _reading) {
      unawaited(_read(++_reads, _readingToken));
    }
    if (failure != null) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            announcementFailureCopy(
              messages,
              failure,
              messages.announcementsMarkAllReadFailed,
            ),
          ),
        ),
      );
    }
  }

  /// Opens [announcement], and marks it read on the way for a signed-in
  /// reader: the row is what they asked for, and a mark that fails says so
  /// over whatever screen they are on.
  void _open(Announcement announcement) {
    if (_accessToken.isNotEmpty && !announcement.isRead) {
      unawaited(_markRead(announcement));
    }
    unawaited(context.pushInTab(AppRoutes.announcementPath(announcement.id)));
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    final announcements = _announcements;
    // Only the rows read so far are counted: the API offers no total, the
    // same reason the site counts the page on screen.
    final unread = announcements?.where((row) => !row.isRead).length ?? 0;
    return Scaffold(
      appBar: AppBar(
        title: Text(messages.announcementsTitle),
        actions: [
          if (signedIn)
            IconButton(
              key: const ValueKey('announcements-mark-all-read'),
              icon: const Icon(Icons.done_all),
              tooltip: messages.announcementsMarkAllRead,
              // Offered while any row is loaded rather than only while one on
              // screen is unread: an unread announcement can still be further
              // down than the rows read so far.
              onPressed: (announcements?.isNotEmpty ?? false) && !_markingAll
                  ? () => unawaited(_markAllRead())
                  : null,
            ),
        ],
      ),
      body: SafeArea(child: _body(messages, signedIn, unread)),
    );
  }

  Widget _body(AppMessages messages, bool signedIn, int unread) {
    if (AnnouncementScope.maybeOf(context) == null) {
      return const SizedBox.shrink();
    }
    final failure = _failure;
    if (failure != null) {
      // Retrying would send the token the API just refused.
      final signIn = failure.kind == AnnouncementFailureKind.sessionExpired;
      return CatalogMessage(
        key: const ValueKey('announcements-error'),
        message: announcementFailureCopy(
          messages,
          failure,
          messages.announcementsFailed,
        ),
        actionKey: ValueKey(
          signIn ? 'announcements-sign-in' : 'announcements-retry',
        ),
        actionLabel: signIn ? messages.commonSignIn : messages.commonRetry,
        onAction: signIn
            ? () => context.pushInTab(AppRoutes.signIn)
            : _readFirstPage,
      );
    }
    final announcements = _announcements;
    if (announcements == null) {
      return const Padding(
        key: ValueKey('announcements-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final hasFooter = _nextToken.isNotEmpty || _moreFailure != null;
    if (announcements.isEmpty && !hasFooter) {
      return RefreshIndicator(
        onRefresh: _refresh,
        // Scrollable so the pull that reads the list again still starts.
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            CatalogMessage(
              key: const ValueKey('announcements-empty'),
              message: messages.announcementsEmpty,
            ),
          ],
        ),
      );
    }
    final header = signedIn ? 1 : 0;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.separated(
        key: const ValueKey('announcements-list'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: header + announcements.length + (hasFooter ? 1 : 0),
        separatorBuilder: (context, index) =>
            index < header ? const SizedBox.shrink() : const Divider(height: 1),
        itemBuilder: (context, index) {
          if (index < header) {
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Text(
                messages.announcementsUnreadShown(
                  count: messages.formatInteger(unread),
                ),
                key: const ValueKey('announcements-unread-count'),
                style: Theme.of(context).textTheme.labelLarge,
              ),
            );
          }
          final row = index - header;
          if (row >= announcements.length - _readAheadRows) {
            _readMore();
          }
          if (row == announcements.length) {
            final moreFailure = _moreFailure;
            return PageFooter(
              sectionKey: 'announcements-more',
              message: moreFailure == null
                  ? null
                  : announcementFailureCopy(
                      messages,
                      moreFailure,
                      messages.announcementsFailed,
                    ),
              onRetry: () {
                setState(() {
                  _moreFailure = null;
                });
                _readMore();
              },
            );
          }
          final announcement = announcements[row];
          return _AnnouncementRow(
            announcement: announcement,
            showReadState: signedIn,
            onOpen: () => _open(announcement),
            onMarkRead: () => unawaited(_markRead(announcement)),
          );
        },
      ),
    );
  }
}

class _AnnouncementRow extends StatelessWidget {
  const _AnnouncementRow({
    required this.announcement,
    required this.showReadState,
    required this.onOpen,
    required this.onMarkRead,
  });

  final Announcement announcement;

  /// Whether the reader holds a session, which is what read state needs.
  final bool showReadState;
  final VoidCallback onOpen;
  final VoidCallback onMarkRead;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final unread = showReadState && !announcement.isRead;
    final createdAt = announcement.createdAt;
    return ListTile(
      key: ValueKey('announcement-row-${announcement.id}'),
      // A visitor has no read state, so their rows carry no gutter for one.
      leading: !showReadState
          ? null
          : SizedBox(
              width: 12,
              child: unread
                  ? Center(
                      child: Semantics(
                        label: messages.announcementsUnread,
                        child: Badge(
                          key: ValueKey(
                            'announcement-unread-${announcement.id}',
                          ),
                          smallSize: 10,
                          backgroundColor: theme.colorScheme.primary,
                        ),
                      ),
                    )
                  : null,
            ),
      minLeadingWidth: 12,
      title: Text(
        announcement.title,
        style: unread ? const TextStyle(fontWeight: FontWeight.bold) : null,
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(announcement.body, maxLines: 1, overflow: TextOverflow.ellipsis),
          if (createdAt != null) Text(messages.formatDateTime(createdAt)),
        ],
      ),
      isThreeLine: createdAt != null,
      trailing: unread
          ? IconButton(
              key: ValueKey('announcement-mark-read-${announcement.id}'),
              icon: const Icon(Icons.mark_email_read_outlined),
              tooltip: messages.announcementsMarkRead,
              onPressed: onMarkRead,
            )
          : null,
      onTap: onOpen,
    );
  }
}
