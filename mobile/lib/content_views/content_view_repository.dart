import 'package:flutter/widgets.dart';

/// The two kinds of page the storefront counts a view of.
enum ContentViewKind {
  series('CONTENT_VIEW_TARGET_TYPE_SERIES'),
  episode('CONTENT_VIEW_TARGET_TYPE_EPISODE');

  const ContentViewKind(this.wireValue);

  /// The `ContentViewTargetType` the API names this kind by.
  final String wireValue;
}

/// Where the app reports that a reader opened a series or an episode, which
/// the tenant's rankings and content statistics are built from.
abstract class ContentViewRepository {
  /// Records one view of the [kind] whose public id is [publicId].
  ///
  /// Throws whatever the call failed with; the caller decides that a view
  /// which could not be recorded is simply lost.
  Future<void> record(ContentViewKind kind, String publicId);
}

/// Looks up the [ContentViewRepository] installed by [ContentViewScope].
///
/// It is absent in a widget test that builds the app without one, so
/// [maybeOf] answers `null` rather than asserting: no view is then recorded.
class ContentViewScope extends InheritedWidget {
  const ContentViewScope({super.key, this.repository, required super.child});

  final ContentViewRepository? repository;

  static ContentViewRepository? maybeOf(BuildContext context) {
    final scope = context
        .dependOnInheritedWidgetOfExactType<ContentViewScope>();
    return scope?.repository;
  }

  @override
  bool updateShouldNotify(ContentViewScope oldWidget) =>
      repository != oldWidget.repository;
}
