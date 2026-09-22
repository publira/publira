import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'support/connect_fixture_server.dart';
import 'support/live_api_precondition.dart';

Matcher failsWith(String reason) => throwsA(
  isA<TestFailure>().having(
    (failure) => failure.message,
    'message',
    contains(reason),
  ),
);

void main() {
  late ConnectFixtureServer server;

  setUp(() async {
    server = ConnectFixtureServer(
      series: ConnectFixtureServer.populatedSeries(),
      details: ConnectFixtureServer.populatedDetails(),
    );
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  Future<void> expectSeed({String? baseUrl, String? seriesPublicId}) =>
      expectLiveSeed(
        baseUrl: baseUrl ?? server.baseUrl,
        tenantHost: 'localhost',
        seriesPublicId: seriesPublicId ?? ConnectFixtureServer.seedSeriesId,
      );

  test('passes when the seed tenant and its series are readable', () async {
    await expectSeed();
  });

  test('names an API the device cannot reach', () async {
    final closedBaseUrl = server.baseUrl;
    await server.close();

    await expectLater(
      expectSeed(baseUrl: closedBaseUrl),
      failsWith('did not serve the device: ConnectException(unavailable'),
    );
  });

  test('names a missing seed tenant', () async {
    server.tenantStatus = HttpStatus.notFound;

    await expectLater(expectSeed(), failsWith('the seed tenant is missing'));
  });

  test('names missing seed rows', () async {
    await expectLater(
      expectSeed(seriesPublicId: 'MissingSERS01'),
      failsWith('the seed rows are missing'),
    );
  });
}
