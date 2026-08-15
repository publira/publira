import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// In-process Connect JSON server that speaks the public catalog/domain RPCs.
///
/// Used by widget-adjacent HTTP tests and by `integration_test` so both
/// exercise the same client against a repeatable fixture.
class ConnectFixtureServer {
  ConnectFixtureServer({
    this.tenantId = defaultTenantId,
    this.tenantHost = 'localhost',
    this.series = const [],
    this.details = const {},
    this.listStatus = HttpStatus.ok,
    this.detailStatus = HttpStatus.ok,
    this.tenantStatus = HttpStatus.ok,
    this.listResponse,
    this.detailResponse,
  });

  static const defaultTenantId = '018f0e6a-1000-7000-8000-000000000001';
  static const seedSeriesId = 'SeedSERSAAA1';
  static const seedSeriesTitle = 'Seed Series 001';
  static const seedSeriesSynopsis = 'Seed series synopsis for Seed Series 001';
  static const seedEpisodeId = 'SeedEPSDAAA1';
  static const seedEpisodeTitle = 'Seed Episode 001-01';

  static List<Map<String, Object?>> populatedSeries() {
    return [
      {
        'publicId': seedSeriesId,
        'title': seedSeriesTitle,
        'synopsis': seedSeriesSynopsis,
        'label': {'name': 'Seed Label 01', 'publicId': 'SeedLABLAAA1'},
      },
      {
        'publicId': 'series-kitchen',
        'title': '小さな台所',
        'synopsis': '一皿から始まる日常料理。',
      },
    ];
  }

  static Map<String, Map<String, Object?>> populatedDetails() {
    return {
      seedSeriesId: {
        'series': {
          'publicId': seedSeriesId,
          'title': seedSeriesTitle,
          'synopsis': seedSeriesSynopsis,
        },
        'episodes': [
          {
            'publicId': seedEpisodeId,
            'title': seedEpisodeTitle,
            'orderIndex': 1,
            'price': 0,
          },
          {
            'publicId': 'SeedEPSDAA1A',
            'title': 'Seed Episode 001-10',
            'orderIndex': 10,
            'price': 500,
          },
        ],
      },
    };
  }

  final String tenantId;
  final String tenantHost;
  List<Map<String, Object?>> series;
  Map<String, Map<String, Object?>> details;
  int listStatus;
  int detailStatus;
  int tenantStatus;
  Object? listResponse;
  Object? detailResponse;

  HttpServer? _server;

  String get baseUrl {
    final server = _server;
    if (server == null) {
      throw StateError('ConnectFixtureServer.start has not been called');
    }
    return 'http://127.0.0.1:${server.port}';
  }

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(_server!.forEach(_handle));
  }

  Future<void> close() async {
    await _server?.close(force: true);
    _server = null;
  }

  Future<void> _handle(HttpRequest request) async {
    final path = request.uri.path;
    if (request.method != 'POST') {
      request.response.statusCode = HttpStatus.methodNotAllowed;
      await request.response.close();
      return;
    }

    if (path.endsWith('/GetTenantByDomain')) {
      await _write(request, tenantStatus, {
        if (tenantStatus == HttpStatus.ok) 'tenantId': tenantId,
        if (tenantStatus != HttpStatus.ok) 'code': 'not_found',
        if (tenantStatus != HttpStatus.ok) 'message': 'tenant not found',
      });
      return;
    }

    if (path.endsWith('/ListPublishedSeries')) {
      await _write(
        request,
        listStatus,
        listResponse ??
            {
              if (listStatus == HttpStatus.ok) 'series': series,
              if (listStatus != HttpStatus.ok) 'code': 'unavailable',
              if (listStatus != HttpStatus.ok) 'message': 'unavailable',
            },
      );
      return;
    }

    if (path.endsWith('/GetSeriesDetail')) {
      if (detailStatus != HttpStatus.ok) {
        await _write(request, detailStatus, {
          'code': 'unavailable',
          'message': 'unavailable',
        });
        return;
      }
      final body = await utf8.decoder.bind(request).join();
      final decoded = jsonDecode(body);
      final publicId = decoded is Map
          ? (decoded['publicId'] as String? ?? '')
          : '';
      final detail = details[publicId];
      if (detail == null) {
        await _write(request, HttpStatus.notFound, {
          'code': 'not_found',
          'message': 'series not found',
        });
        return;
      }
      await _write(request, HttpStatus.ok, detailResponse ?? detail);
      return;
    }

    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
  }

  Future<void> _write(HttpRequest request, int status, Object body) async {
    request.response.statusCode = status;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode(body));
    await request.response.close();
  }
}
