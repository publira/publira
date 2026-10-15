import 'dart:convert';

import 'package:fixnum/fixnum.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/auth.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/catalog.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/domain.pb.dart' as pb;
import 'package:publira/api/unknown_enum.dart';

import 'support/connect_fixture_server.dart';
import 'support/proto_response.dart';

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

  test('a call round-trips a binary request and answer', () async {
    final client = ConnectClient(baseUrl: server.baseUrl);
    final response = await _listSeries(
      client,
      pb.ListPublishedSeriesRequest(limit: 20),
      ConnectCallContext(tenantId: ConnectFixtureServer.defaultTenantId),
    );

    expect(response.series, isNotEmpty);
    expect(response.series.first.publicId, ConnectFixtureServer.seedSeriesId);
  });

  test('a call maps a Connect error code', () async {
    server.detailStatus = 503;
    final client = ConnectClient(baseUrl: server.baseUrl);

    expect(
      () => _getSeriesDetail(client),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.code,
          'code',
          'unavailable',
        ),
      ),
    );
  });

  test('a call maps a non-JSON 502 response to unavailable', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async {
        return http.Response('<html>Bad Gateway</html>', 502);
      }),
    );

    expect(
      () => _listSeries(client),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.code,
          'code',
          'unavailable',
        ),
      ),
    );
  });

  test('a call maps a success body that does not decode to internal', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async => protoBytesResponse(undecodableBody)),
    );

    expect(
      () => _listSeries(client),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.code,
          'code',
          'internal',
        ),
      ),
    );
  });

  test('a call treats a closed port as unavailable', () async {
    final closedBaseUrl = server.baseUrl;
    await server.close();
    final client = ConnectClient(
      baseUrl: closedBaseUrl,
      timeout: const Duration(milliseconds: 200),
    );

    expect(
      () => _listSeries(client),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.isUnavailable,
          'isUnavailable',
          isTrue,
        ),
      ),
    );
  });

  test('a call maps a request that outruns the timeout', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      timeout: const Duration(milliseconds: 20),
      httpClient: MockClient((_) async {
        await Future<void>.delayed(const Duration(seconds: 1));
        return protoBytesResponse(const []);
      }),
    );

    await expectLater(
      _listSeries(client),
      throwsA(
        isA<ConnectException>()
            .having((error) => error.code, 'code', 'deadline_exceeded')
            .having((error) => error.isUnavailable, 'isUnavailable', isTrue),
      ),
    );
  });

  test('a call reads an empty success body as an empty message', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async => protoBytesResponse(const [])),
    );

    final response = await _listSeries(client);

    expect(response, pb.ListPublishedSeriesResponse());
  });

  test('a call rejects a success in another codec', () async {
    for (final response in [
      http.Response('{}', 200, headers: {'content-type': 'application/json'}),
      http.Response(
        '<html>Sign in to the network</html>',
        200,
        headers: {'content-type': 'text/html'},
      ),
      http.Response('', 200),
    ]) {
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient((_) async => response),
      );

      await expectLater(
        _listSeries(client),
        throwsA(
          isA<ConnectException>().having(
            (error) => error.code,
            'code',
            'internal',
          ),
        ),
        reason: 'content-type ${response.headers['content-type']}',
      );
    }
  });

  test('a call keeps the code and message an error body carries', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode(const {
            'code': 'not_found',
            'message': 'series not found',
          }),
          404,
        );
      }),
    );

    expect(
      () => _getSeriesDetail(client),
      throwsA(
        isA<ConnectException>()
            .having((error) => error.code, 'code', 'not_found')
            .having((error) => error.message, 'message', 'series not found')
            .having((error) => error.isNotFound, 'isNotFound', isTrue),
      ),
    );
  });

  test('a call keeps the ErrorInfo reasons an error body carries', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode({
            'code': 'permission_denied',
            'message': 'reader is credited on the episode',
            'details': [
              ConnectFixtureServer.errorInfoDetail(
                readerCreditedOnEpisodeReason,
              ),
            ],
          }),
          403,
        );
      }),
    );

    expect(
      () => pb.RatingServiceApi(
        client,
      ).rateEpisode(null, pb.RateEpisodeRequest()),
      throwsA(
        isA<ConnectException>()
            .having((error) => error.code, 'code', 'permission_denied')
            .having((error) => error.reasons, 'reasons', [
              readerCreditedOnEpisodeReason,
            ]),
      ),
    );
  });

  group('errorReasonsOf', () {
    test('reads the reason of an ErrorInfo detail the API owns', () {
      expect(
        errorReasonsOf([
          ConnectFixtureServer.badRequestDetail('episode_id'),
          ConnectFixtureServer.errorInfoDetail('READER_CREDITED_ON_EPISODE'),
        ]),
        ['READER_CREDITED_ON_EPISODE'],
      );
    });

    test('skips a reason under another domain', () {
      expect(
        errorReasonsOf([
          ConnectFixtureServer.errorInfoDetail(
            'READER_CREDITED_ON_EPISODE',
            domain: 'example.com',
          ),
        ]),
        isEmpty,
      );
    });

    test('skips a detail that does not decode', () {
      expect(
        errorReasonsOf([
          {'type': 'google.rpc.ErrorInfo', 'value': 'CgUKA2Zv'},
        ]),
        isEmpty,
      );
      expect(errorReasonsOf(null), isEmpty);
    });
  });

  test(
    'a call falls back to the status when an error body has no code',
    () async {
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient((_) async {
          return http.Response('{}', 400);
        }),
      );

      expect(
        () => _getSeriesDetail(client),
        throwsA(
          isA<ConnectException>()
              .having((error) => error.code, 'code', 'internal')
              .having((error) => error.message, 'message', 'HTTP 400'),
        ),
      );
    },
  );

  test('a call posts the Connect envelope and the tenant header', () async {
    late http.Request sent;
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((request) async {
        sent = request;
        return protoBytesResponse(const []);
      }),
    );

    await _listSeries(
      client,
      pb.ListPublishedSeriesRequest(limit: 20),
      ConnectCallContext(tenantId: '  tenant-1  '),
    );

    expect(
      sent.url.toString(),
      'https://example.test/rpc/publira.v1.CatalogService/ListPublishedSeries',
    );
    expect(sent.method, 'POST');
    expect(sent.headers['connect-protocol-version'], '1');
    expect(sent.headers['X-Publira-Tenant-Id'], 'tenant-1');
    expect(sent.headers.containsKey('authorization'), isFalse);
    expect(sent.headers['content-type'], 'application/proto');
    expect(
      pb.ListPublishedSeriesRequest.fromBuffer(sent.bodyBytes),
      pb.ListPublishedSeriesRequest(limit: 20),
    );
  });

  test('a call sends the procedure under /rpc on the base origin', () async {
    late http.Request sent;
    final client = ConnectClient(
      baseUrl: 'http://127.0.0.1:8000',
      httpClient: MockClient((request) async {
        sent = request;
        return protoBytesResponse(const []);
      }),
    );

    await pb.DomainServiceApi(
      client,
    ).getTenantByDomain(null, pb.GetTenantByDomainRequest());

    expect(
      sent.url.toString(),
      'http://127.0.0.1:8000/rpc/publira.v1.DomainService/GetTenantByDomain',
    );
  });

  test('a call omits the tenant header when no tenant is given', () async {
    late http.Request sent;
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((request) async {
        sent = request;
        return protoBytesResponse(const []);
      }),
    );

    await pb.DomainServiceApi(client).getTenantByDomain(
      ConnectCallContext(tenantId: '   '),
      pb.GetTenantByDomainRequest(),
    );

    expect(sent.headers.containsKey('X-Publira-Tenant-Id'), isFalse);
  });

  test('a call reads the access token again on every call', () async {
    var token = '';
    final authorizations = <String?>[];
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      accessToken: () => token,
      httpClient: MockClient((request) async {
        authorizations.add(request.headers['authorization']);
        return protoBytesResponse(const []);
      }),
    );

    await _getMe(client);
    token = '  member-token  ';
    await _getMe(client);

    expect(authorizations, [null, 'Bearer member-token']);
    expect(client.accessToken, 'member-token');
  });

  test('a call can replace the token the client holds', () async {
    late http.Request sent;
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      accessToken: () => 'stored-token',
      httpClient: MockClient((request) async {
        sent = request;
        return protoBytesResponse(const []);
      }),
    );

    await _getMe(client, ConnectCallContext(accessToken: 'candidate-token'));

    expect(sent.headers['authorization'], 'Bearer candidate-token');
    expect(client.accessToken, 'stored-token');
  });

  test('a call sends the headers its context names', () async {
    late http.Request sent;
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((request) async {
        sent = request;
        return protoBytesResponse(const []);
      }),
    );

    await _getMe(client, ConnectCallContext(headers: {'cookie': 'a=b'}));

    expect(sent.headers['cookie'], 'a=b');
    expect(sent.headers['content-type'], 'application/proto');
  });

  test('a call hands the answer\'s headers back on its context', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient(
        (_) async => protoBytesResponse(
          const [],
          headers: {'set-cookie': 'publira_aid=minted'},
        ),
      ),
    );
    final ctx = ConnectCallContext();

    await _getMe(client, ctx);

    expect(ctx.responseHeaders['set-cookie'], 'publira_aid=minted');
  });

  test('a call context\'s timeout replaces the client\'s own', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async {
        await Future<void>.delayed(const Duration(milliseconds: 100));
        return protoBytesResponse(const []);
      }),
    );

    await expectLater(
      _getMe(
        client,
        ConnectCallContext(timeout: const Duration(milliseconds: 10)),
      ),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.code,
          'code',
          'deadline_exceeded',
        ),
      ),
    );
  });

  test('a call skips a field this build does not know', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient(
        (_) async => protoResponse(
          pb.ListPublishedSeriesResponse(nextToken: '20')
            ..unknownFields.mergeVarintField(_addedLaterField, Int64.ONE),
        ),
      ),
    );

    final response = await _listSeries(client);

    expect(response.nextToken, '20');
    expect(response.unknownFields.hasField(_addedLaterField), isTrue);
  });

  test(
    'a call keeps an enum value this build does not know apart from zero',
    () async {
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient(
          (_) async => protoResponse(
            pb.ListPublishedSeriesResponse(
              series: [
                pb.Series(publicId: 'omitted'),
                pb.Series(
                  publicId: 'known',
                  ageRating: pb.SeriesAgeRating.SERIES_AGE_RATING_R15,
                ),
                // A value a later API numbers, which no enum here names.
                pb.Series(publicId: 'later')
                  ..unknownFields.mergeVarintField(
                    _ageRatingField,
                    Int64(_unnamedEnumValue),
                  ),
              ],
            ),
          ),
        ),
      );

      final series = (await _listSeries(client)).series;

      expect(
        [for (final item in series) item.ageRating],
        [
          pb.SeriesAgeRating.SERIES_AGE_RATING_UNSPECIFIED,
          pb.SeriesAgeRating.SERIES_AGE_RATING_R15,
          pb.SeriesAgeRating.SERIES_AGE_RATING_UNSPECIFIED,
        ],
      );
      expect(
        [for (final item in series) carriesUnknownEnum(item, _ageRatingField)],
        [false, false, true],
      );
    },
  );
}

/// `Series.age_rating`.
const _ageRatingField = 15;

/// A field number no message here declares, standing for one a later API
/// adds.
const _addedLaterField = 999;

/// An enum number no enum here names, standing for a value a later API adds.
const _unnamedEnumValue = 999;

/// `ListPublishedSeries` with [request], the call most of these go through.
Future<pb.ListPublishedSeriesResponse> _listSeries(
  ConnectClient client, [
  pb.ListPublishedSeriesRequest? request,
  ConnectCallContext? ctx,
]) => pb.CatalogServiceApi(
  client,
).listPublishedSeries(ctx, request ?? pb.ListPublishedSeriesRequest());

Future<pb.GetSeriesDetailResponse> _getSeriesDetail(ConnectClient client) =>
    pb.CatalogServiceApi(
      client,
    ).getSeriesDetail(null, pb.GetSeriesDetailRequest(publicId: 'x'));

Future<pb.GetMeResponse> _getMe(
  ConnectClient client, [
  ConnectCallContext? ctx,
]) => pb.AuthServiceApi(client).getMe(ctx, pb.GetMeRequest());
