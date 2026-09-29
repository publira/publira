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
          locale: 'en',
        ),
        '/blank': (title: 'Blank', contentMarkdown: '', locale: 'en'),
        '/legal/privacy': (
          title: 'Privacy policy',
          contentMarkdown: 'How we keep your data.',
          locale: 'ja',
        ),
      },
    );
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('get reads the page published at a slug in a locale', () async {
    final page = await repository().get('/legal/terms', locale: 'en');

    expect(page.slug, '/legal/terms');
    expect(page.title, 'Terms of service');
    expect(page.contentMarkdown, '## Terms');
    expect(page.locale, 'en');
    expect(server.requestsTo('GetPublishedPage').single.body, {
      'tenant': {'tenantId': ConnectFixtureServer.defaultTenantId},
      'slug': '/legal/terms',
      'locale': 'en',
    });
  });

  test('get reads the locale of the translation served', () async {
    final page = await repository().get('/legal/privacy', locale: 'en');

    expect(page.locale, 'ja');
  });

  test('get reads a page published with nothing written as empty', () async {
    expect(
      (await repository().get('/blank', locale: 'en')).contentMarkdown,
      isEmpty,
    );
  });

  test('get maps a slug with no page to notFound', () async {
    await expectLater(
      repository().get('/gone', locale: 'en'),
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
      repository().get('/legal/terms', locale: 'en'),
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
    expect(await repository().listSlugs(), {
      '/legal/terms',
      '/blank',
      '/legal/privacy',
    });
  });
}
