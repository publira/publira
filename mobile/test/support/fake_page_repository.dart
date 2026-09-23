import 'package:publira/pages/page_failure.dart';
import 'package:publira/pages/page_repository.dart';
import 'package:publira/pages/published_page.dart';

/// [PageRepository] that answers from the pages a test sets on it.
class FakePageRepository implements PageRepository {
  FakePageRepository({this.pages = const []});

  List<PublishedPage> pages;

  /// Thrown by [get] in place of reading [pages], until a test clears it.
  PageFailure? getFailure;

  /// Thrown by [listSlugs] in place of reading [pages].
  PageFailure? listFailure;

  /// The slugs [get] has been asked for, in order.
  final reads = <String>[];

  @override
  Future<PublishedPage> get(String slug) async {
    reads.add(slug);
    final failure = getFailure;
    if (failure != null) {
      throw failure;
    }
    for (final page in pages) {
      if (page.slug == slug) {
        return page;
      }
    }
    throw const PageFailure(PageFailureKind.notFound);
  }

  @override
  Future<Set<String>> listSlugs() async {
    final failure = listFailure;
    if (failure != null) {
      throw failure;
    }
    return {for (final page in pages) page.slug};
  }
}
