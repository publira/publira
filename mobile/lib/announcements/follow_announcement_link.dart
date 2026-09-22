import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/announcements/announcement_board.dart';
import 'package:publira/announcements/announcement_link.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/link_scope.dart';

/// Where [linkUrl] takes the reader from [context], or `null` when it is not
/// a link the app may follow, which is also what a run with no tenant site
/// answers.
AnnouncementDestination? announcementDestinationFrom(
  BuildContext context,
  String linkUrl,
) {
  final site = LinkScope.maybeOf(context)?.site;
  if (site == null) {
    return null;
  }
  return announcementDestination(
    linkUrl,
    site: site,
    locale: Localizations.localeOf(context).toLanguageTag(),
  );
}

/// Opens [destination]: a screen of the app, or the browser for a page the
/// app has none for, saying so when nothing took it.
void followAnnouncementDestination(
  BuildContext context,
  AnnouncementDestination destination,
) {
  switch (destination) {
    case InAppAnnouncementDestination(:final location):
      unawaited(context.push(location));
    case ExternalAnnouncementDestination(:final url):
      final board = AnnouncementScope.maybeOf(context);
      final messenger = ScaffoldMessenger.of(context);
      final failed = AppMessages.of(context).announcementsOpenLinkFailed;
      unawaited(() async {
        final opened = await board?.openExternal(url) ?? false;
        if (!opened) {
          messenger.showSnackBar(SnackBar(content: Text(failed)));
        }
      }());
  }
}
