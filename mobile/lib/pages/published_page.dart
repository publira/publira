import 'package:flutter/foundation.dart';

/// A page the tenant has published, as `PublicPagesService/GetPublishedPage`
/// answers it.
@immutable
class PublishedPage {
  const PublishedPage({
    required this.slug,
    required this.title,
    required this.contentMarkdown,
  });

  /// In storage form (`/privacy`).
  final String slug;
  final String title;
  final String contentMarkdown;
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
