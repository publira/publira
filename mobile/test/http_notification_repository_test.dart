import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/models/inbox_notification.dart';
import 'package:publira/notifications/http_notification_repository.dart';
import 'package:publira/notifications/notification_failure.dart';

import 'support/connect_fixture_server.dart';

void main() {
  /// One `NotificationItem` as the API answers it.
  Map<String, Object?> row(
    String id, {
    String type = 'episode_published',
    String payload = '{"series_id":"SeedSERSAAA1","episode_id":"SeedEPSDAAA1"}',
    bool isRead = false,
    String createdAt = '2026-09-08T10:30:00Z',
  }) {
    return {
      'id': id,
      'notificationType': type,
      'payload': payload,
      // protojson omits a false.
      if (isRead) 'isRead': true,
      'createdAt': createdAt,
    };
  }

  late ConnectFixtureServer server;
  late String accessToken;

  HttpNotificationRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpNotificationRepository(
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

  test('the rows map onto what the inbox renders', () async {
    server.notifications = [
      row('n-1'),
      row('n-2', type: 'comment_hidden', isRead: true, payload: '{}'),
    ];

    final page = await repository().list();

    final first = page.notifications.first;
    expect(first.id, 'n-1');
    expect(first.kind, InboxNotificationKind.episodePublished);
    expect(first.payload.seriesId, ConnectFixtureServer.seedSeriesId);
    expect(first.payload.episodeId, ConnectFixtureServer.seedEpisodeId);
    expect(first.isRead, isFalse);
    expect(first.createdAt, DateTime.utc(2026, 9, 8, 10, 30).toLocal());
    expect(page.notifications.last.kind, InboxNotificationKind.commentHidden);
    expect(page.notifications.last.isRead, isTrue);
    expect(page.nextToken, isEmpty);

    final request = server.requestsTo('ListNotifications').single;
    expect(request.body['limit'], HttpNotificationRepository.pageSize);
    expect(request.headers['authorization'], 'Bearer $accessToken');
  });

  test('a page carries the token of the page under it', () async {
    server
      ..notifications = [row('n-1'), row('n-2')]
      ..notificationsPageSize = 1;

    final first = await repository().list();
    expect(first.notifications.single.id, 'n-1');
    expect(first.nextToken, isNotEmpty);

    final second = await repository().list(token: first.nextToken);
    expect(second.notifications.single.id, 'n-2');
    expect(second.nextToken, isEmpty);
    expect(server.requestsTo('ListNotifications').last.body['token'], '1');
  });

  test('a row naming no id is left out of the list', () async {
    server.notifications = [row(''), row('n-2')];

    final page = await repository().list();

    expect(page.notifications.single.id, 'n-2');
  });

  test('an empty inbox reads as an empty page and a zero count', () async {
    expect((await repository().list()).notifications, isEmpty);
    expect(await repository().countUnread(), 0);
  });

  test('the count is the unread rows the API holds', () async {
    server.notifications = [row('n-1'), row('n-2', isRead: true), row('n-3')];

    expect(await repository().countUnread(), 2);
  });

  test('a read mark names the notification and lowers the count', () async {
    server.notifications = [row('n-1'), row('n-2')];

    await repository().markRead('n-1');

    expect(
      server.requestsTo('MarkNotificationAsRead').single.body['notificationId'],
      'n-1',
    );
    expect(await repository().countUnread(), 1);
  });

  test('marking everything read leaves nothing unread', () async {
    server.notifications = [row('n-1'), row('n-2')];

    await repository().markAllRead();

    expect(server.requestsTo('MarkAllNotificationsAsRead'), hasLength(1));
    expect(await repository().countUnread(), 0);
  });

  test('a reader who is signed out asks for nothing', () async {
    accessToken = '';

    expect((await repository().list()).notifications, isEmpty);
    expect(await repository().countUnread(), 0);
    expect(server.requestsTo('ListNotifications'), isEmpty);
    expect(server.requestsTo('CountUnreadNotifications'), isEmpty);
  });

  test('a read mark without a session fails before the request', () async {
    accessToken = '';

    await expectLater(
      repository().markRead('n-1'),
      throwsA(
        isA<NotificationFailure>().having(
          (failure) => failure.kind,
          'kind',
          NotificationFailureKind.sessionExpired,
        ),
      ),
    );
    expect(server.requestsTo('MarkNotificationAsRead'), isEmpty);
  });

  test('a session the API no longer takes asks for a sign-in', () async {
    accessToken = 'stale-token';

    await expectLater(
      repository().list(),
      throwsA(
        isA<NotificationFailure>().having(
          (failure) => failure.kind,
          'kind',
          NotificationFailureKind.sessionExpired,
        ),
      ),
    );
  });

  test('an API that cannot be reached is a network failure', () async {
    server.notificationStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      repository().countUnread(),
      throwsA(
        isA<NotificationFailure>().having(
          (failure) => failure.kind,
          'kind',
          NotificationFailureKind.network,
        ),
      ),
    );
  });
}
