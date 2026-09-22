import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/announcements/announcement_failure.dart';
import 'package:publira/announcements/http_announcement_repository.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';

import 'support/connect_fixture_server.dart';

void main() {
  /// One `AnnouncementItem` as the API answers it.
  Map<String, Object?> row(
    String id, {
    bool isRead = false,
    String linkUrl = '/series/SeedSERSAAA1',
    String pinnedUntil = '',
  }) {
    return {
      'id': id,
      'announcementType': 'info',
      'title': 'Notice $id',
      'body': 'Body of $id',
      'linkUrl': linkUrl,
      // protojson omits a false.
      if (isRead) 'isRead': true,
      'createdAt': '2026-09-20T09:00:00Z',
      if (pinnedUntil.isNotEmpty) 'pinned': true,
      if (pinnedUntil.isNotEmpty) 'pinnedUntil': pinnedUntil,
    };
  }

  Matcher failsWith(AnnouncementFailureKind kind) => throwsA(
    isA<AnnouncementFailure>().having((failure) => failure.kind, 'kind', kind),
  );

  late ConnectFixtureServer server;
  late String accessToken;

  HttpAnnouncementRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpAnnouncementRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  setUp(() async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server = ConnectFixtureServer();
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('the rows map onto what the list renders', () async {
    server.announcements = [row('a-1'), row('a-2', isRead: true)];

    final page = await repository().list();

    final first = page.announcements.first;
    expect(first.id, 'a-1');
    expect(first.title, 'Notice a-1');
    expect(first.body, 'Body of a-1');
    expect(first.linkUrl, '/series/SeedSERSAAA1');
    expect(first.isRead, isFalse);
    expect(first.createdAt, DateTime.utc(2026, 9, 20, 9).toLocal());
    expect(page.announcements.last.isRead, isTrue);
    expect(page.nextToken, isEmpty);

    final request = server.requestsTo('ListAnnouncements').single;
    expect(request.body['limit'], HttpAnnouncementRepository.pageSize);
    expect(request.headers['authorization'], 'Bearer $accessToken');
  });

  test('a page carries the token of the page under it', () async {
    server
      ..announcements = [row('a-1'), row('a-2')]
      ..announcementsPageSize = 1;

    final first = await repository().list();
    expect(first.announcements.single.id, 'a-1');

    final second = await repository().list(token: first.nextToken);
    expect(second.announcements.single.id, 'a-2');
    expect(second.nextToken, isEmpty);
    expect(server.requestsTo('ListAnnouncements').last.body['token'], '1');
  });

  test('a row naming no id is left out of the list', () async {
    server.announcements = [row(''), row('a-2')];

    expect((await repository().list()).announcements.single.id, 'a-2');
  });

  test('a visitor reads the list without a session', () async {
    accessToken = '';
    server.announcements = [row('a-1', isRead: true)];

    final page = await repository().list();

    expect(page.announcements.single.isRead, isFalse);
    expect(
      server.requestsTo('ListAnnouncements').single.headers['authorization'],
      isNull,
    );
  });

  test('one announcement is read by its id', () async {
    server.announcements = [row('a-1'), row('a-2')];

    final announcement = await repository().get('a-2');

    expect(announcement.title, 'Notice a-2');
    expect(
      server.requestsTo('GetAnnouncement').single.body['announcementId'],
      'a-2',
    );
  });

  test('a missing announcement is not found', () async {
    await expectLater(
      repository().get('gone'),
      failsWith(AnnouncementFailureKind.notFound),
    );
  });

  test('the pinned read carries its window and no session', () async {
    server
      ..announcements = [row('a-1', pinnedUntil: '2026-10-01T00:00:00Z')]
      ..pinnedAnnouncementId = 'a-1';

    final pinned = await repository().pinned();

    expect(pinned?.id, 'a-1');
    expect(pinned?.pinnedUntil, DateTime.utc(2026, 10).toLocal());
    expect(
      server
          .requestsTo('GetPinnedAnnouncement')
          .single
          .headers['authorization'],
      isNull,
    );
  });

  test('a tenant with nothing pinned answers none', () async {
    server.announcements = [row('a-1')];

    expect(await repository().pinned(), isNull);
  });

  test('a read mark names the announcement', () async {
    server.announcements = [row('a-1'), row('a-2')];

    await repository().markRead('a-1');

    expect(
      server.requestsTo('MarkAnnouncementAsRead').single.body['announcementId'],
      'a-1',
    );
    final page = await repository().list();
    expect(page.announcements.first.isRead, isTrue);
    expect(page.announcements.last.isRead, isFalse);
  });

  test('marking everything read leaves nothing unread', () async {
    server.announcements = [row('a-1'), row('a-2')];

    await repository().markAllRead();

    expect(server.requestsTo('MarkAllAnnouncementsAsRead'), hasLength(1));
    final page = await repository().list();
    expect(page.announcements.every((item) => item.isRead), isTrue);
  });

  test('a read mark without a session fails before the request', () async {
    accessToken = '';

    await expectLater(
      repository().markRead('a-1'),
      failsWith(AnnouncementFailureKind.sessionExpired),
    );
    expect(server.requestsTo('MarkAnnouncementAsRead'), isEmpty);
  });

  test('a session the API no longer takes cannot mark', () async {
    accessToken = 'stale-token';
    server.announcements = [row('a-1')];

    await expectLater(
      repository().markAllRead(),
      failsWith(AnnouncementFailureKind.sessionExpired),
    );
  });

  test('an API that cannot be reached is a network failure', () async {
    server.announcementStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      repository().list(),
      failsWith(AnnouncementFailureKind.network),
    );
  });
}
