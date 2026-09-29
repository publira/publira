import 'package:flutter/widgets.dart';
import 'package:publira/pages/published_page.dart';

/// The reader's half of `publira.v1.PublicPagesService`.
abstract class PageRepository {
  /// The page published at [slug], in storage form.
  ///
  /// Throws [PageFailure].
  Future<PublishedPage> get(String slug);

  /// Every published page's slug, in storage form, which is how a link to a
  /// path on the tenant site is told to be one of its pages.
  ///
  /// Throws [PageFailure].
  Future<Set<String>> listSlugs();
}

/// Looks up the [PageRepository] installed by [PageScope].
///
/// It is absent in a widget test that builds the app without one, so
/// [maybeOf] answers `null` rather than asserting: no link then resolves to a
/// page, and the page screen reports it cannot read one.
class PageScope extends InheritedWidget {
  const PageScope({super.key, this.repository, required super.child});

  final PageRepository? repository;

  static PageRepository? maybeOf(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<PageScope>();
    return scope?.repository;
  }

  @override
  bool updateShouldNotify(PageScope oldWidget) =>
      repository != oldWidget.repository;
}
