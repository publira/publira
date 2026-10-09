import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/app.dart';
import 'package:publira/router.dart';
import 'package:publira/tenant/tenant_availability.dart';

import 'support/connect_fixture_server.dart';
import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';

const _tenantId = '018f0e6a-1000-7000-8000-000000000001';

http.Response _suspendedResponse() => http.Response(
  jsonEncode({
    'code': 'failed_precondition',
    'message': 'tenant is suspended',
    'details': [ConnectFixtureServer.errorInfoDetail(tenantSuspendedReason)],
  }),
  400,
);

void main() {
  group('ConnectClient', () {
    test('reports a suspended tenant, and a served one again', () async {
      var suspended = true;
      final availability = TenantAvailability(check: () async {});
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        availability: availability,
        httpClient: MockClient((_) async {
          return suspended
              ? _suspendedResponse()
              : http.Response(jsonEncode(const {'tenantId': _tenantId}), 200);
        }),
      );

      await expectLater(
        client.unary('/publira.v1.CatalogService/ListPublishedSeries', {}),
        throwsA(
          isA<ConnectException>().having(
            (error) => error.isTenantSuspended,
            'isTenantSuspended',
            isTrue,
          ),
        ),
      );
      expect(availability.suspended, isTrue);

      suspended = false;
      await client.unary('/publira.v1.DomainService/GetTenantByDomain', {});
      expect(availability.suspended, isFalse);
    });

    test('a failure of any other kind says nothing about the tenant', () async {
      final availability = TenantAvailability(check: () async {});
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        availability: availability,
        httpClient: MockClient((_) async {
          return http.Response(
            jsonEncode({
              'code': 'failed_precondition',
              'message': 'invitation canceled',
              'details': [
                ConnectFixtureServer.errorInfoDetail('INVITATION_CANCELED'),
              ],
            }),
            400,
          );
        }),
      );

      await expectLater(
        client.unary('/publira.v1.CatalogService/ListPublishedSeries', {}),
        throwsA(isA<ConnectException>()),
      );
      expect(availability.suspended, isFalse);
    });
  });

  group('TenantAvailability', () {
    test(
      'a recheck the API cannot answer leaves the tenant suspended',
      () async {
        final availability = TenantAvailability(
          check: () async => throw const ConnectException(
            code: 'unavailable',
            message: 'offline',
          ),
        )..reportSuspended();

        await availability.recheck();

        expect(availability.suspended, isTrue);
        expect(availability.checking, isFalse);
      },
    );
  });

  group('the app', () {
    Future<void> pumpApp(
      WidgetTester tester,
      TenantAvailability availability,
    ) async {
      await tester.pumpWidget(
        PubliraApp(
          router: createAppRouter(),
          catalog: FakeCatalogRepository(series: fixtureSeries),
          auth: fakeAuthController(),
          offline: InMemoryOfflineLibrary(),
          tenantAvailability: availability,
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('says it is unavailable in place of every screen while the '
        'tenant is suspended', (tester) async {
      final availability = TenantAvailability(check: () async {});
      await pumpApp(tester, availability);
      expect(find.byKey(const ValueKey('tenant-unavailable')), findsNothing);

      availability.reportSuspended();
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('tenant-unavailable')), findsOneWidget);
      expect(find.text('This app is unavailable right now'), findsOneWidget);
      expect(find.byType(AppBar), findsNothing);
    });

    testWidgets('asks again on retry, and opens the app once the tenant is '
        'served', (tester) async {
      final answered = Completer<void>();
      late final TenantAvailability availability;
      availability = TenantAvailability(
        check: () async {
          await answered.future;
          availability.reportServed();
        },
      )..reportSuspended();
      await pumpApp(tester, availability);
      expect(find.byKey(const ValueKey('tenant-unavailable')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('tenant-unavailable-retry')));
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('tenant-unavailable-retry')),
            )
            .onPressed,
        isNull,
      );

      answered.complete();
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('tenant-unavailable')), findsNothing);
      expect(find.byType(AppBar), findsWidgets);
    });
  });
}
