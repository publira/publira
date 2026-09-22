import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/announcements/announcement_board.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// The one announcement the operator asked every reader to see, at the top of
/// the catalog.
///
/// It draws nothing when the tenant has nothing pinned, when the window has
/// closed, or when this device has closed it: an addition to the screen has
/// no empty state. The read behind it names no reader, so a visitor who never
/// signed in sees the same banner.
class PinnedAnnouncementBanner extends StatelessWidget {
  const PinnedAnnouncementBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final board = AnnouncementScope.maybeOf(context);
    final announcement = board?.banner;
    if (board == null || announcement == null) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Material(
      key: ValueKey('pinned-announcement-${announcement.id}'),
      color: colors.secondaryContainer,
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 4, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsetsDirectional.only(top: 2, end: 12),
                  child: Icon(
                    Icons.campaign_outlined,
                    color: colors.onSecondaryContainer,
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        announcement.title,
                        style: theme.textTheme.titleSmall?.copyWith(
                          color: colors.onSecondaryContainer,
                        ),
                      ),
                      if (announcement.body.isNotEmpty)
                        Text(
                          announcement.body,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: colors.onSecondaryContainer,
                          ),
                        ),
                    ],
                  ),
                ),
                IconButton(
                  key: const ValueKey('pinned-announcement-dismiss'),
                  icon: const Icon(Icons.close),
                  color: colors.onSecondaryContainer,
                  tooltip: messages.announcementsBannerDismiss,
                  onPressed: () => unawaited(board.dismiss(announcement.id)),
                ),
              ],
            ),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton(
                key: const ValueKey('pinned-announcement-open'),
                // The detail is where the whole body and the operator's link
                // are, so the banner opens it rather than the link itself.
                onPressed: () => unawaited(
                  context.pushInTab(
                    AppRoutes.announcementPath(announcement.id),
                  ),
                ),
                child: Text(messages.announcementsBannerLink),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
