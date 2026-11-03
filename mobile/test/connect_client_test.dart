import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

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
import 'package:publira/tenant/tenant_availability.dart';

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

  test(
    'a call maps a 429 without an error body to resource_exhausted',
    () async {
      for (final response in [
        http.Response('', 429),
        http.Response(
          'Too Many Requests',
          429,
          headers: {'content-type': 'text/plain; charset=utf-8'},
        ),
        http.Response(
          '<html><head><title>429 Too Many Requests</title></head></html>',
          429,
          headers: {'content-type': 'text/html'},
        ),
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
              'resource_exhausted',
            ),
          ),
          reason: 'body "${response.body}"',
        );
      }
    },
  );

  test('a refusal carries the wait its Retry-After names', () async {
    for (final response in [
      // publira server's own refusal: a Connect error body.
      http.Response(
        jsonEncode(const {
          'code': 'resource_exhausted',
          'message': 'too many reads',
        }),
        429,
        headers: {'content-type': 'application/json', 'retry-after': '12'},
      ),
      // An edge's refusal, in a body of its own.
      http.Response(
        '<html><head><title>429 Too Many Requests</title></head></html>',
        429,
        headers: {'content-type': 'text/html', 'retry-after': '12'},
      ),
    ]) {
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient((_) async => response),
      );

      await expectLater(
        _listSeries(client),
        throwsA(
          isA<ConnectException>()
              .having((error) => error.code, 'code', 'resource_exhausted')
              .having(
                (error) => error.retryAfter,
                'retryAfter',
                const Duration(seconds: 12),
              ),
        ),
        reason: 'body "${response.body}"',
      );
    }
  });

  test('a refusal without a Retry-After in seconds carries no wait', () async {
    for (final headers in [
      const <String, String>{},
      const {'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT'},
      const {'retry-after': '-1'},
    ]) {
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient(
          (_) async => http.Response('', 429, headers: headers),
        ),
      );

      await expectLater(
        _listSeries(client),
        throwsA(
          isA<ConnectException>()
              .having((error) => error.code, 'code', 'resource_exhausted')
              .having((error) => error.retryAfter, 'retryAfter', isNull),
        ),
        reason: 'headers $headers',
      );
    }
  });

  test('a call keeps the code a 429 error body names', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode(const {
            'code': 'unavailable',
            'message': 'try again later',
          }),
          429,
        );
      }),
    );

    expect(
      () => _listSeries(client),
      throwsA(
        isA<ConnectException>()
            .having((error) => error.code, 'code', 'unavailable')
            .having((error) => error.message, 'message', 'try again later'),
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

  group('a server-streaming call', () {
    final ready = pb.DataExport(
      state: pb.DataExportState.DATA_EXPORT_STATE_READY,
    );
    final member = ConnectCallContext(
      tenantId: ConnectFixtureServer.defaultTenantId,
      accessToken: ConnectFixtureServer.memberAccessToken,
    );

    test('yields every message the stream carries, in order', () async {
      server
        ..memberDataExport = ready
        ..dataExportArchive = [
          [1, 2, 3],
          [4, 5],
        ];
      final client = ConnectClient(baseUrl: server.baseUrl);

      final pieces = await _download(client, member).toList();

      expect(
        [for (final piece in pieces) piece.data],
        [
          [1, 2, 3],
          [4, 5],
        ],
      );
      final sent = server.requestsTo('DownloadMyDataExport').single;
      expect(sent.headers['content-type'], 'application/connect+proto');
      expect(
        sent.headers['x-publira-tenant-id'],
        ConnectFixtureServer.defaultTenantId,
      );
      expect(
        sent.decodeEnveloped(pb.DownloadMyDataExportRequest()),
        pb.DownloadMyDataExportRequest(),
      );
    });

    test('throws a refusal sent before the first message', () async {
      final client = ConnectClient(baseUrl: server.baseUrl);

      expect(
        _download(client, member).toList(),
        throwsA(
          isA<ConnectException>()
              .having((error) => error.code, 'code', 'not_found')
              .having(
                (error) => error.message,
                'message',
                'no data export is ready',
              ),
        ),
      );
    });

    test('throws a refusal sent after the messages it follows', () async {
      server
        ..memberDataExport = ready
        ..dataExportArchive = [
          [1, 2, 3],
        ]
        ..dataExportStreamError = {
          'code': 'failed_precondition',
          'message': 'the tenant is suspended',
          'details': [ConnectFixtureServer.errorInfoDetail('TENANT_SUSPENDED')],
        };
      final availability = TenantAvailability(check: () async {});
      final client = ConnectClient(
        baseUrl: server.baseUrl,
        availability: availability,
      );
      final pieces = <List<int>>[];

      await expectLater(
        _download(
          client,
          member,
        ).map((piece) => piece.data).forEach(pieces.add),
        throwsA(
          isA<ConnectException>().having((error) => error.reasons, 'reasons', [
            tenantSuspendedReason,
          ]),
        ),
      );
      expect(pieces, [
        [1, 2, 3],
      ]);
      expect(availability.suspended, isTrue);
    });

    test('reads a stream cut off before its end as unavailable', () async {
      server
        ..memberDataExport = ready
        ..dataExportArchive = [
          [1],
        ]
        ..dataExportStreamCutOff = true;
      final client = ConnectClient(baseUrl: server.baseUrl);

      expect(
        _download(client, member).toList(),
        throwsA(
          isA<ConnectException>().having(
            (error) => error.code,
            'code',
            'unavailable',
          ),
        ),
      );
    });

    test('reads a message split across any number of pieces', () async {
      final body = [
        ..._envelope(
          0,
          pb.DownloadMyDataExportResponse(data: [7, 8, 9]).writeToBuffer(),
        ),
        ..._envelope(2, utf8.encode('{}')),
      ];
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient.streaming(
          (_, _) async => http.StreamedResponse(
            Stream.fromIterable([
              for (final byte in body) [byte],
            ]),
            200,
            headers: {'content-type': 'application/connect+proto'},
          ),
        ),
      );

      final pieces = await _download(client).toList();

      expect(
        [for (final piece in pieces) piece.data],
        [
          [7, 8, 9],
        ],
      );
    });

    test('carries the wait the end of the stream names', () async {
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient.streaming(
          (_, _) async => http.StreamedResponse(
            Stream.value(
              _envelope(
                2,
                utf8.encode(
                  jsonEncode({
                    'error': {'code': 'resource_exhausted', 'message': 'slow'},
                    'metadata': {
                      'retry-after': ['30'],
                    },
                  }),
                ),
              ),
            ),
            200,
            headers: {'content-type': 'application/connect+proto'},
          ),
        ),
      );

      expect(
        _download(client).toList(),
        throwsA(
          isA<ConnectException>()
              .having((error) => error.code, 'code', 'resource_exhausted')
              .having(
                (error) => error.retryAfter,
                'retryAfter',
                const Duration(seconds: 30),
              ),
        ),
      );
    });

    test('reads a refusal an edge answered with a status of its own', () async {
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient((_) async {
          return http.Response(
            'rate limited',
            429,
            headers: {'retry-after': '5'},
          );
        }),
      );

      expect(
        _download(client).toList(),
        throwsA(
          isA<ConnectException>()
              .having((error) => error.code, 'code', 'resource_exhausted')
              .having(
                (error) => error.retryAfter,
                'retryAfter',
                const Duration(seconds: 5),
              ),
        ),
      );
    });

    test('rejects a success in another codec', () async {
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient((_) async => protoBytesResponse(const [])),
      );

      expect(
        _download(client).toList(),
        throwsA(
          isA<ConnectException>().having(
            (error) => error.code,
            'code',
            'internal',
          ),
        ),
      );
    });

    test('gives up on a stream that stops arriving', () async {
      final stalled = StreamController<List<int>>();
      addTearDown(stalled.close);
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        timeout: const Duration(milliseconds: 50),
        httpClient: MockClient.streaming(
          (_, _) async => http.StreamedResponse(
            stalled.stream,
            200,
            headers: {'content-type': 'application/connect+proto'},
          ),
        ),
      );

      expect(
        _download(client).toList(),
        throwsA(
          isA<ConnectException>().having(
            (error) => error.code,
            'code',
            'deadline_exceeded',
          ),
        ),
      );
    });
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

/// `DownloadMyDataExport`, the server-streaming call these go through.
Stream<pb.DownloadMyDataExportResponse> _download(
  ConnectClient client, [
  ConnectCallContext? ctx,
]) => client.serverStream(
  ctx,
  'AuthService',
  'DownloadMyDataExport',
  pb.DownloadMyDataExportRequest(),
  pb.DownloadMyDataExportResponse.new,
);

/// [payload] enveloped under [flags], as the Connect protocol's streaming
/// form sends a message.
Uint8List _envelope(int flags, List<int> payload) {
  final envelope = Uint8List(5 + payload.length);
  envelope[0] = flags;
  ByteData.sublistView(envelope).setUint32(1, payload.length);
  envelope.setAll(5, payload);
  return envelope;
}
