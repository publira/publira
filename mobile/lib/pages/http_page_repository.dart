import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/page.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/pages/page_failure.dart';
import 'package:publira/pages/page_repository.dart';
import 'package:publira/pages/published_page.dart';

/// [PageRepository] backed by `publira.v1.PublicPagesService`.
class HttpPageRepository implements PageRepository {
  const HttpPageRepository({required this._client, required this._tenants});

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<PublishedPage> get(String slug, {required String locale}) async {
    final pb.GetPublishedPageResponse body;
    try {
      final tenantId = await _tenants.resolve();
      body = await pb.PublicPagesServiceApi(_client).getPublishedPage(
        ConnectCallContext(tenantId: tenantId),
        pb.GetPublishedPageRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          slug: slug,
          locale: locale,
        ),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
    if (!body.hasPage()) {
      throw const PageFailure(
        PageFailureKind.unexpected,
        message: 'GetPublishedPage answered without a page',
      );
    }
    final page = body.page;
    return PublishedPage(
      slug: page.slug,
      title: page.title,
      // protojson omits an empty body, and a page may have been published
      // with nothing written yet.
      contentMarkdown: body.version.contentMarkdown,
      locale: page.locale,
    );
  }

  @override
  Future<List<PublishedPageLink>> list({required String locale}) async {
    final pb.ListPublishedPagesResponse body;
    try {
      final tenantId = await _tenants.resolve();
      body = await pb.PublicPagesServiceApi(_client).listPublishedPages(
        ConnectCallContext(tenantId: tenantId),
        pb.ListPublishedPagesRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          locale: locale,
        ),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
    return [for (final page in body.pages) ?_link(page)];
  }

  /// [page] as a link, or `null` when it has no slug to open or no title to
  /// name it by.
  static PublishedPageLink? _link(pb.Page page) {
    final slug = page.slug.trim();
    final title = page.title.trim();
    if (slug.isEmpty || title.isEmpty) {
      return null;
    }
    return PublishedPageLink(slug: pageSlugFromPath(slug), title: title);
  }

  @override
  Future<Set<String>> listSlugs() async {
    final pb.ListPublishedPageSlugsResponse body;
    try {
      final tenantId = await _tenants.resolve();
      body = await pb.PublicPagesServiceApi(_client).listPublishedPageSlugs(
        ConnectCallContext(tenantId: tenantId),
        pb.ListPublishedPageSlugsRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
    return {
      for (final slug in body.slugs)
        if (slug.trim().isNotEmpty) pageSlugFromPath(slug),
    };
  }

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
