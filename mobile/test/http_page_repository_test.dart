import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/pages/http_page_repository.dart';
import 'package:publira/pages/page_failure.dart';

import 'support/connect_fixture_server.dart';

void main() {
  late ConnectFixtureServer server;

  HttpPageRepository repository() {
    final client = ConnectClient(baseUrl: server.baseUrl);
    return HttpPageRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  setUp(() async {
    server = ConnectFixtureServer(
      publishedPages: {
        '/legal/terms': (
          title: 'Terms of service',
          contentMarkdown: '## Terms',
        ),
        '/blank': (title: 'Blank', contentMarkdown: ''),
      },
    );
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('get reads the page published at a slug', () async {
    final page = await repository().get('/legal/terms');

    expect(page.slug, '/legal/terms');
    expect(page.title, 'Terms of service');
    expect(page.contentMarkdown, '## Terms');
    expect(server.requestsTo('GetPublishedPage').single.body, {
      'tenant': {'tenantId': ConnectFixtureServer.defaultTenantId},
      'slug': '/legal/terms',
    });
  });

  test('get reads a page published with nothing written as empty', () async {
    expect((await repository().get('/blank')).contentMarkdown, isEmpty);
  });

  test('get maps a slug with no page to notFound', () async {
    await expectLater(
      repository().get('/gone'),
      throwsA(
        isA<PageFailure>().having(
          (failure) => failure.kind,
          'kind',
          PageFailureKind.notFound,
        ),
      ),
    );
  });

  test('get maps an unreachable API to network', () async {
    server.pageStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      repository().get('/legal/terms'),
      throwsA(
        isA<PageFailure>().having(
          (failure) => failure.kind,
          'kind',
          PageFailureKind.network,
        ),
      ),
    );
  });

  test('listSlugs reads every published slug in storage form', () async {
    expect(await repository().listSlugs(), {'/legal/terms', '/blank'});
  });
}
