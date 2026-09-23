import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/link_scope.dart';
import 'package:publira/links/tenant_link.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/pages/page_repository.dart';
import 'package:publira/pages/published_page.dart';
import 'package:publira/router.dart';

/// Where [linkUrl] takes the reader from [context], or `null` when it is not
/// a link the app may follow, which is also what a run with no tenant site
/// answers.
TenantLinkDestination? tenantLinkDestinationFrom(
  BuildContext context,
  String linkUrl,
) {
  final site = LinkScope.maybeOf(context)?.site;
  if (site == null) {
    return null;
  }
  return tenantLinkDestination(
    linkUrl,
    site: site,
    locale: Localizations.localeOf(context).toLanguageTag(),
  );
}

/// Opens [destination]: a screen of the app, the page screen for one of the
/// tenant's published pages, or the browser for any other page, saying so
/// when nothing took it.
///
/// Whether a site path is a published page is asked when the link is
/// followed, so a page published since the app started is still found.
void followTenantLink(BuildContext context, TenantLinkDestination destination) {
  switch (destination) {
    case InAppDestination(:final location):
      context.openInTab(location);
    case SitePathDestination(:final path, :final url):
      final pages = PageScope.maybeOf(context);
      unawaited(() async {
        final slug = pageSlugFromPath(path);
        Set<String> slugs;
        try {
          slugs = await pages?.listSlugs() ?? const {};
        } on Exception {
          slugs = const {};
        }
        if (!context.mounted) {
          return;
        }
        if (slugs.contains(slug)) {
          context.openInTab(AppRoutes.publishedPagePath(slug));
        } else {
          _openInBrowser(context, url);
        }
      }());
    case ExternalDestination(:final url):
      _openInBrowser(context, url);
  }
}

void _openInBrowser(BuildContext context, Uri url) {
  final browser = LinkScope.maybeOf(context)?.browser;
  final messenger = ScaffoldMessenger.of(context);
  final failed = AppMessages.of(context).commonOpenLinkFailed;
  unawaited(() async {
    bool opened;
    try {
      opened = await browser?.open(url) ?? false;
    } on Object {
      opened = false;
    }
    if (!opened) {
      messenger.showSnackBar(SnackBar(content: Text(failed)));
    }
  }());
}
