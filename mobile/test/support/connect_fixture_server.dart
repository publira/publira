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
    this.episodes = const {},
    this.listStatus = HttpStatus.ok,
    this.detailStatus = HttpStatus.ok,
    this.episodeStatus = HttpStatus.ok,
    this.tenantStatus = HttpStatus.ok,
    this.listResponse,
    this.detailResponse,
    this.episodeResponse,
  });

  static const defaultTenantId = '018f0e6a-1000-7000-8000-000000000001';
  static const seedSeriesId = 'SeedSERSAAA1';
  static const seedSeriesTitle = 'Seed Series 001';
  static const seedSeriesSynopsis = 'Seed series synopsis for Seed Series 001';
  static const seedEpisodeId = 'SeedEPSDAAA1';
  static const seedEpisodeTitle = 'Seed Episode 001-01';
  static const seedEpisodePageCount = 3;
  static const paidEpisodeId = 'SeedEPSDAA1A';

  /// 1x1 transparent PNG, enough for `Image.network` to decode a real page on
  /// a device.
  static final pageBytes = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAC'
    'hwGA60e6kgAAAABJRU5ErkJggg==',
  );

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

  /// `GetEpisodeDetail` bodies: the seed episode is free and has pages, the
  /// paid one is locked and has none.
  static Map<String, Map<String, Object?>> populatedEpisodes() {
    return {
      seedEpisodeId: {
        'episode': {
          'publicId': seedEpisodeId,
          'title': seedEpisodeTitle,
          'orderIndex': 1,
          'price': 0,
        },
        'series': {'publicId': seedSeriesId, 'title': seedSeriesTitle},
        'access': 'EPISODE_ACCESS_FREE',
        'images': [
          for (var page = 1; page <= seedEpisodePageCount; page++)
            {
              'id': '$seedEpisodeId-page-$page',
              'imageUrl': '/images/episodes/$seedEpisodeId-page-$page',
              'contentType': 'image/png',
              'displayOrder': page,
              'width': 800,
              'height': 1200,
            },
        ],
      },
      paidEpisodeId: {
        'episode': {
          'publicId': paidEpisodeId,
          'title': 'Seed Episode 001-10',
          'orderIndex': 10,
          'price': 500,
        },
        'series': {'publicId': seedSeriesId, 'title': seedSeriesTitle},
        'access': 'EPISODE_ACCESS_LOCKED',
      },
    };
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

  /// `GetEpisodeDetail` bodies keyed by episode public id.
  Map<String, Map<String, Object?>> episodes;
  int listStatus;
  int detailStatus;
  int episodeStatus;
  int tenantStatus;
  Object? listResponse;
  Object? detailResponse;
  Object? episodeResponse;

  /// Headers of the last `GET /images/...` request, so a test can assert what
  /// the reader sends to image-server.
  HttpHeaders? lastImageRequestHeaders;

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
    if (request.method == 'GET' && path.startsWith('/images/')) {
      lastImageRequestHeaders = request.headers;
      request.response.statusCode = HttpStatus.ok;
      request.response.headers.contentType = ContentType('image', 'png');
      request.response.add(pageBytes);
      await request.response.close();
      return;
    }
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
      final publicId = await _readPublicId(request);
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

    if (path.endsWith('/GetEpisodeDetail')) {
      if (episodeStatus != HttpStatus.ok) {
        await _write(request, episodeStatus, {
          'code': 'unavailable',
          'message': 'unavailable',
        });
        return;
      }
      final publicId = await _readPublicId(request);
      final episode = episodes[publicId];
      if (episode == null) {
        await _write(request, HttpStatus.notFound, {
          'code': 'not_found',
          'message': 'episode not found',
        });
        return;
      }
      await _write(request, HttpStatus.ok, episodeResponse ?? episode);
      return;
    }

    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
  }

  Future<String> _readPublicId(HttpRequest request) async {
    final body = await utf8.decoder.bind(request).join();
    final decoded = jsonDecode(body);
    return decoded is Map ? (decoded['publicId'] as String? ?? '') : '';
  }

  Future<void> _write(HttpRequest request, int status, Object body) async {
    request.response.statusCode = status;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode(body));
    await request.response.close();
  }
}
