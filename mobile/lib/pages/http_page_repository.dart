import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/pages/page_failure.dart';
import 'package:publira/pages/page_repository.dart';
import 'package:publira/pages/published_page.dart';

/// [PageRepository] backed by `publira.v1.PublicPagesService`.
class HttpPageRepository implements PageRepository {
  const HttpPageRepository({required this._client, required this._tenants});

  static const _getProcedure =
      '/publira.v1.PublicPagesService/GetPublishedPage';
  static const _listProcedure =
      '/publira.v1.PublicPagesService/ListPublishedPages';
  static const _listSlugsProcedure =
      '/publira.v1.PublicPagesService/ListPublishedPageSlugs';

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<PublishedPage> get(String slug, {required String locale}) async {
    final Map<String, Object?> body;
    try {
      final tenantId = await _tenants.resolve();
      body = await _client.unary(_getProcedure, {
        'tenant': {'tenantId': tenantId},
        'slug': slug,
        'locale': locale,
      }, tenantId: tenantId);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
    final page = body['page'];
    final version = body['version'];
    if (page is! Map<String, Object?>) {
      throw const PageFailure(
        PageFailureKind.unexpected,
        message: 'GetPublishedPage answered without a page',
      );
    }
    return PublishedPage(
      slug: _string(page['slug']),
      title: _string(page['title']),
      // protojson omits an empty body, and a page may have been published
      // with nothing written yet.
      contentMarkdown: version is Map<String, Object?>
          ? _string(version['contentMarkdown'])
          : '',
      locale: _string(page['locale']),
    );
  }

  @override
  Future<List<PublishedPageLink>> list({required String locale}) async {
    final Map<String, Object?> body;
    try {
      final tenantId = await _tenants.resolve();
      body = await _client.unary(_listProcedure, {
        'tenant': {'tenantId': tenantId},
        'locale': locale,
      }, tenantId: tenantId);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
    final pages = body['pages'];
    return [
      if (pages is List)
        for (final page in pages)
          if (page is Map<String, Object?>) ?_link(page),
    ];
  }

  /// [page] as a link, or `null` when it has no slug to open or no title to
  /// name it by.
  static PublishedPageLink? _link(Map<String, Object?> page) {
    final slug = _string(page['slug']).trim();
    final title = _string(page['title']).trim();
    if (slug.isEmpty || title.isEmpty) {
      return null;
    }
    return PublishedPageLink(slug: pageSlugFromPath(slug), title: title);
  }

  @override
  Future<Set<String>> listSlugs() async {
    final Map<String, Object?> body;
    try {
      final tenantId = await _tenants.resolve();
      body = await _client.unary(_listSlugsProcedure, {
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
    final slugs = body['slugs'];
    return {
      if (slugs is List)
        for (final slug in slugs)
          if (slug is String && slug.trim().isNotEmpty) pageSlugFromPath(slug),
    };
  }

  static String _string(Object? value) => value is String ? value : '';

  PageFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return PageFailure(PageFailureKind.network, message: error.message);
    }
    return switch (error.code) {
      'not_found' || 'invalid_argument' => PageFailure(
        PageFailureKind.notFound,
        message: error.message,
      ),
      _ => PageFailure(PageFailureKind.unexpected, message: error.message),
    };
  }
}
