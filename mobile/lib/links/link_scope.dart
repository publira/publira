import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/links/external_browser.dart';
import 'package:publira/links/share_sheet.dart';
import 'package:publira/models/series_item.dart';

/// The tenant site, the share sheet, and the browser this run can use.
class LinkScope extends InheritedWidget {
  const LinkScope({
    super.key,
    required this.site,
    required this.share,
    this.browser,
    required super.child,
  });

  final PublicSite site;
  final ShareSheet? share;

  /// Where a page on another site opens, absent in a widget test that does
  /// not follow one.
  final ExternalBrowser? browser;

  static LinkScope? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<LinkScope>();
  }

  @override
  bool updateShouldNotify(LinkScope oldWidget) {
    return site != oldWidget.site ||
        share != oldWidget.share ||
        browser != oldWidget.browser;
  }
}

/// App-bar action that hands [path] to the platform share sheet.
///
/// Missing when this run has no share sheet, which is what a widget test
/// that does not care about sharing gets, and the action stays off.
class ShareAction extends StatelessWidget {
  const ShareAction({
    super.key,
    required this.path,
    required this.title,
    this.workTitle,
    this.credits = const [],
  });

  /// In-app path of the page being shared, without a locale prefix.
  final String path;

  /// What this page is called: the action's tooltip, and the share sheet's
  /// own title.
  final String title;

  /// The work the shared message names. Defaults to [title], which is the
  /// series on the series screen; the viewer passes the series while [title]
  /// stays the episode, so the address is the page and the wording is the
  /// work a reader would recognise it by.
  final String? workTitle;

  final List<SeriesCreator> credits;

  @override
  Widget build(BuildContext context) {
    final links = LinkScope.maybeOf(context);
    final share = links?.share;
    if (links == null || share == null) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    return IconButton(
      icon: const Icon(Icons.share_outlined),
      tooltip: messages.shareAria(title: title),
      onPressed: () {
        final locale = Localizations.localeOf(context).toLanguageTag();
        final url = links.site.uriFor(path, locale: locale);
        final text = shareMessage(
          messages,
          title: workTitle ?? title,
          creatorNames: [for (final credit in credits) credit.name],
        );
        unawaited(share.share(url: url, title: title, text: text));
      },
    );
  }
}
