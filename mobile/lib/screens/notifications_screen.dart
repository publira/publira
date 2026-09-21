import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/inbox_notification.dart';
import 'package:publira/notifications/notification_copy.dart';
import 'package:publira/notifications/notification_failure.dart';
import 'package:publira/notifications/notification_inbox.dart';
import 'package:publira/router.dart';

/// How many rows before the end of the list the page under it is asked for,
/// the same read-ahead the other paged lists use.
const _readAheadRows = 5;

/// The signed-in reader's notifications, newest first.
///
/// This is the record of what the reader was told, whether or not a push ever
/// reached the device: a row is read here, marked read here, and opens what it
/// is about.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  /// Every page read so far as one list, and `null` while the first is still
  /// in flight.
  List<InboxNotification>? _notifications;

  /// What the API calls the page under [_notifications]. Empty at the end of
  /// the list, which is what takes the footer away.
  var _nextToken = '';

  /// The first page's failure, which is the whole screen, and a later page's,
  /// which is the footer under the rows already on screen.
  NotificationFailure? _failure;
  NotificationFailure? _moreFailure;

  /// Whether a page is in flight. The screen is not built from it, so it is
  /// set without [setState], which is what lets the list ask for a page while
  /// it builds.
  var _reading = false;

  /// Counts the reads this screen has started, so an answer meant for the
  /// reader before this one cannot land on the list.
  var _reads = 0;

  /// Completes the pull to refresh once the first page is back.
  Completer<void>? _refreshing;

  var _markingAll = false;
  var _accessToken = '';
  var _started = false;

  /// Reads the list again whenever the reader changes: the inbox belongs to
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
      _notifications = null;
      _nextToken = '';
      _failure = null;
      _moreFailure = null;
      _reading = _accessToken.isNotEmpty;
    });
    _reads++;
    if (_accessToken.isEmpty) {
      return;
    }
    unawaited(_read(_reads, ''));
    // The badge is read with the list, so the two agree once it is on screen.
    unawaited(NotificationScope.maybeOf(context)?.refresh());
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
    unawaited(_read(++_reads, _nextToken));
  }

  Future<void> _read(int read, String token) async {
    final inbox = NotificationScope.maybeOf(context);
    if (inbox == null) {
      return;
    }
    final isFirstPage = token.isEmpty;
    InboxNotificationPage? page;
    NotificationFailure? failure;
    try {
      page = await inbox.list(token: token);
    } on NotificationFailure catch (error) {
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
        if (isFirstPage) {
          _failure = failure;
        } else {
          _moreFailure = failure;
        }
        return;
      }
      _notifications = [
        if (!isFirstPage) ...?_notifications,
        ...page.notifications,
      ];
      _nextToken = page.nextToken;
    });
  }

  /// Marks [notification] read on the API, and on the row once it has been.
  ///
  /// The answer is dropped when another reader holds the session by then:
  /// it was about the rows of the reader who asked.
  Future<void> _markRead(InboxNotification notification) async {
    final inbox = NotificationScope.maybeOf(context);
    if (inbox == null) {
      return;
    }
    final auth = AuthScope.of(context);
    final accessToken = _accessToken;
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await inbox.markRead(notification.id);
    } on NotificationFailure catch (failure) {
      if (auth.accessToken != accessToken) {
        return;
      }
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            _failureCopy(
              messages,
              failure,
              messages.notificationsMarkReadFailed,
            ),
          ),
        ),
      );
      return;
    }
    if (!mounted || accessToken != _accessToken) {
      return;
    }
    setState(() {
      _notifications = [
        for (final row in _notifications ?? const <InboxNotification>[])
          row.id == notification.id ? row.markedRead() : row,
      ];
    });
  }

  Future<void> _markAllRead() async {
    final inbox = NotificationScope.maybeOf(context);
    if (inbox == null) {
      return;
    }
    final accessToken = _accessToken;
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _markingAll = true;
    });
    NotificationFailure? failure;
    try {
      await inbox.markAllRead();
    } on NotificationFailure catch (error) {
      failure = error;
    }
    // Another reader's rows were read since, and the session change has
    // already put the button back.
    if (!mounted || accessToken != _accessToken) {
      return;
    }
    setState(() {
      _markingAll = false;
      if (failure == null) {
        _notifications = [
          for (final row in _notifications ?? const <InboxNotification>[])
            row.markedRead(),
        ];
      }
    });
    if (failure != null) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            _failureCopy(
              messages,
              failure,
              messages.notificationsMarkAllReadFailed,
            ),
          ),
        ),
      );
    }
  }

  /// Opens what [notification] is about, and marks it read on the way.
  ///
  /// The read mark does not hold the reader back: the row is what they asked
  /// for, and a mark that fails says so over whatever screen they are on. A
  /// notification naming nothing the app can open lands on the catalog.
  void _open(InboxNotification notification) {
    if (!notification.isRead) {
      unawaited(_markRead(notification));
    }
    final location = notificationLocation(notification);
    if (location == null) {
      context.go(AppRoutes.catalog);
      return;
    }
    unawaited(context.push(location));
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final inbox = NotificationScope.maybeOf(context);
    final hasUnread =
        (inbox?.unreadCount ?? 0) > 0 ||
        (_notifications?.any((row) => !row.isRead) ?? false);
    return Scaffold(
      appBar: AppBar(
        title: Text(messages.notificationsTitle),
        actions: [
          if (inbox != null && AuthScope.of(context).isSignedIn)
            IconButton(
              key: const ValueKey('notifications-mark-all-read'),
              icon: const Icon(Icons.done_all),
              tooltip: messages.notificationsMarkAllRead,
              onPressed: hasUnread && !_markingAll
                  ? () => unawaited(_markAllRead())
                  : null,
            ),
        ],
      ),
      body: SafeArea(child: _body(messages, inbox)),
    );
  }

  Widget _body(AppMessages messages, NotificationInbox? inbox) {
    if (inbox == null) {
      return const SizedBox.shrink();
    }
    if (!AuthScope.of(context).isSignedIn) {
      return CatalogMessage(
        key: const ValueKey('notifications-signed-out'),
        message: messages.notificationsSignInPrompt,
        actionKey: const ValueKey('notifications-sign-in'),
        actionLabel: messages.commonSignIn,
        onAction: () => context.push(
          AppRoutes.signInPath(returnTo: AppRoutes.accountNotifications),
        ),
      );
    }
    final failure = _failure;
    if (failure != null) {
      return CatalogMessage(
        key: const ValueKey('notifications-error'),
        message: _failureCopy(messages, failure, messages.notificationsFailed),
        actionKey: const ValueKey('notifications-retry'),
        actionLabel: messages.commonRetry,
        onAction: _readFirstPage,
      );
    }
    final notifications = _notifications;
    if (notifications == null) {
      return const Padding(
        key: ValueKey('notifications-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final hasFooter = _nextToken.isNotEmpty || _moreFailure != null;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: notifications.isEmpty && !hasFooter
          // Scrollable so the pull that reads the inbox again still starts.
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                CatalogMessage(
                  key: const ValueKey('notifications-empty'),
                  message: messages.notificationsEmpty,
                ),
              ],
            )
          : ListView.separated(
              key: const ValueKey('notifications-list'),
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: notifications.length + (hasFooter ? 1 : 0),
              separatorBuilder: (context, index) => const Divider(height: 1),
              itemBuilder: (context, index) {
                if (index >= notifications.length - _readAheadRows) {
                  _readMore();
                }
                if (index == notifications.length) {
                  final moreFailure = _moreFailure;
                  return PageFooter(
                    sectionKey: 'notifications-more',
                    message: moreFailure == null
                        ? null
                        : _failureCopy(
                            messages,
                            moreFailure,
                            messages.notificationsFailed,
                          ),
                    onRetry: () {
                      setState(() {
                        _moreFailure = null;
                      });
                      _readMore();
                    },
                  );
                }
                final notification = notifications[index];
                return _NotificationRow(
                  notification: notification,
                  onOpen: () => _open(notification),
                  onMarkRead: () => unawaited(_markRead(notification)),
                );
              },
            ),
    );
  }

  String _failureCopy(
    AppMessages messages,
    NotificationFailure failure,
    String fallback,
  ) {
    return switch (failure.kind) {
      NotificationFailureKind.network => messages.errorsRpcUnavailable,
      NotificationFailureKind.sessionExpired =>
        messages.errorsRpcUnauthenticated,
      NotificationFailureKind.unexpected => fallback,
    };
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({
    required this.notification,
    required this.onOpen,
    required this.onMarkRead,
  });

  final InboxNotification notification;
  final VoidCallback onOpen;
  final VoidCallback onMarkRead;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final unread = !notification.isRead;
    final description = messages.notificationDescription(notification);
    final createdAt = notification.createdAt;
    return ListTile(
      key: ValueKey('notification-${notification.id}'),
      leading: SizedBox(
        width: 12,
        child: unread
            ? Center(
                child: Semantics(
                  label: messages.notificationsUnread,
                  child: Badge(
                    key: ValueKey('notification-unread-${notification.id}'),
                    smallSize: 10,
                    backgroundColor: theme.colorScheme.primary,
                  ),
                ),
              )
            : null,
      ),
      minLeadingWidth: 12,
      title: Text(
        messages.notificationTitle(notification),
        style: unread ? const TextStyle(fontWeight: FontWeight.bold) : null,
      ),
      subtitle: Text(
        createdAt == null
            ? description
            : '$description\n${messages.formatDateTime(createdAt)}',
      ),
      isThreeLine: createdAt != null,
      trailing: unread
          ? IconButton(
              key: ValueKey('notification-mark-read-${notification.id}'),
              icon: const Icon(Icons.mark_email_read_outlined),
              tooltip: messages.notificationsMarkRead,
              onPressed: onMarkRead,
            )
          : null,
      onTap: onOpen,
    );
  }
}
