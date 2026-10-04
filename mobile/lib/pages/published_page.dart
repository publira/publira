import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/locale_negotiation.dart';

/// A page the tenant has published, as `PublicPagesService/GetPublishedPage`
/// answers it.
@immutable
class PublishedPage {
  const PublishedPage({
    required this.slug,
    required this.title,
    required this.contentMarkdown,
    required this.locale,
  });

  /// In storage form (`/privacy`).
  final String slug;
  final String title;
  final String contentMarkdown;

  /// The code of the translation served, which differs from the locale asked
  /// for when the page has no published translation in it.
  final String locale;

  /// The name of the language the page is shown in, when that is not
  /// [requested], or `null` when the page is in the language asked for.
  ///
  /// The name is the catalog's own label, the one `web-host` shows, so a
  /// served locale no catalog carries has none and is reported as `null`.
  String? fallbackLanguage(Locale requested) {
    final served = supportedLocaleForCode(locale);
    if (served == null || served.toLanguageTag() == requested.toLanguageTag()) {
      return null;
    }
    return AppMessages.forLocale(served)?.localeLabel;
  }
}

/// A page the tenant lists where the storefront's footer does, as
/// `PublicPagesService/ListPublishedPages` answers it: enough to name the page
/// and open it.
@immutable
class PublishedPageLink {
  const PublishedPageLink({required this.slug, required this.title});

  /// In storage form (`/privacy`).
  final String slug;
  final String title;

  @override
  bool operator ==(Object other) =>
      other is PublishedPageLink && other.slug == slug && other.title == title;

  @override
  int get hashCode => Object.hash(slug, title);

  @override
  String toString() => 'PublishedPageLink($slug, $title)';
}

/// [path] in the storage form a slug is kept in: one leading slash, no
/// trailing one, and lower case, the way the site matches a path to a page.
String pageSlugFromPath(String path) {
  final segments = [
    for (final segment in path.split('/'))
      if (segment.trim().isNotEmpty) segment.trim().toLowerCase(),
  ];
  return '/${segments.join('/')}';
}
