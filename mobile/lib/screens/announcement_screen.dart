import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/announcements/announcement_board.dart';
import 'package:publira/announcements/announcement_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/follow_tenant_link.dart';
import 'package:publira/links/tenant_link.dart';
import 'package:publira/models/announcement.dart';

/// One announcement: its title, when it was posted, its body, and the link
/// the operator gave it.
///
/// A visitor reads it as a signed-in reader does. Opening it is what reading
/// it means, so a signed-in reader's unread announcement is marked read here.
class AnnouncementScreen extends StatefulWidget {
  const AnnouncementScreen({super.key, required this.announcementId});

  final String announcementId;

  @override
  State<AnnouncementScreen> createState() => _AnnouncementScreenState();
}

class _AnnouncementScreenState extends State<AnnouncementScreen> {
  Announcement? _announcement;
  AnnouncementFailure? _failure;

  /// Counts the reads this screen has started, so an answer meant for the
  /// reader before this one cannot land on the screen.
  var _reads = 0;
  var _accessToken = '';
  var _started = false;

  /// Reads the announcement again whenever the reader changes: read state
  /// belongs to whoever holds the session.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final accessToken = AuthScope.of(context).accessToken;
    if (_started && accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _read();
  }

  void _read() {
    final board = AnnouncementScope.maybeOf(context);
    setState(() {
      _announcement = null;
      _failure = null;
    });
    if (board == null) {
      return;
    }
    unawaited(_load(board, ++_reads));
  }

  Future<void> _load(AnnouncementBoard board, int read) async {
    Announcement? announcement;
    AnnouncementFailure? failure;
    try {
      announcement = await board.get(widget.announcementId);
    } on AnnouncementFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _announcement = announcement;
      _failure = failure;
    });
    if (announcement != null &&
        !announcement.isRead &&
        _accessToken.isNotEmpty) {
      unawaited(_markRead(board, announcement, read));
    }
  }

  /// The mark is not something the reader asked for, so a mark that fails is
  /// left for the list's own button rather than reported over the body.
  Future<void> _markRead(
    AnnouncementBoard board,
    Announcement announcement,
    int read,
  ) async {
    try {
      await board.markRead(announcement.id);
    } on AnnouncementFailure {
      return;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _announcement = announcement.markedRead();
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(messages.announcementsTitle)),
      body: SafeArea(child: _body(messages)),
    );
  }

  Widget _body(AppMessages messages) {
    final failure = _failure;
    if (failure != null) {
      if (failure.kind == AnnouncementFailureKind.notFound) {
        return CatalogMessage(
          key: const ValueKey('announcement-not-found'),
          message: messages.announcementsNotFound,
        );
      }
      return CatalogMessage(
        key: const ValueKey('announcement-error'),
        message: announcementFailureCopy(
          messages,
          failure,
          messages.announcementsDetailFailed,
        ),
        actionKey: const ValueKey('announcement-retry'),
        actionLabel: messages.commonRetry,
        onAction: _read,
      );
    }
    final announcement = _announcement;
    if (announcement == null) {
      return const Padding(
        key: ValueKey('announcement-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final theme = Theme.of(context);
    final createdAt = announcement.createdAt;
    final destination = tenantLinkDestinationFrom(
      context,
      announcement.linkUrl,
    );
    return ListView(
      key: ValueKey('announcement-${announcement.id}'),
      padding: const EdgeInsets.all(16),
      children: [
        Text(announcement.title, style: theme.textTheme.titleLarge),
        if (createdAt != null) ...[
          const SizedBox(height: 4),
          Text(
            messages.formatDateTime(createdAt),
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
        const SizedBox(height: 16),
        SelectableText(announcement.body, style: theme.textTheme.bodyLarge),
        if (destination != null) ...[
          const SizedBox(height: 24),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: FilledButton.icon(
              key: const ValueKey('announcement-open-link'),
              icon: Icon(
                destination is ExternalDestination
                    ? Icons.open_in_new
                    : Icons.arrow_forward,
              ),
              label: Text(messages.announcementsOpenLink),
              onPressed: () => followTenantLink(context, destination),
            ),
          ),
        ],
      ],
    );
  }
}

/// What a failed announcement call says: the classification the rest of the
/// app shows for the same failure, or [fallback] for anything else.
String announcementFailureCopy(
  AppMessages messages,
  AnnouncementFailure failure,
  String fallback,
) {
  return switch (failure.kind) {
    AnnouncementFailureKind.network => messages.errorsRpcUnavailable,
    AnnouncementFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
    AnnouncementFailureKind.notFound ||
    AnnouncementFailureKind.unexpected => fallback,
  };
}
