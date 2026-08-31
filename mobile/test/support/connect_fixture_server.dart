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
    this.entitledEpisodes = const {},
    this.listStatus = HttpStatus.ok,
    this.detailStatus = HttpStatus.ok,
    this.episodeStatus = HttpStatus.ok,
    this.tenantStatus = HttpStatus.ok,
    this.activeAccessToken = memberAccessToken,
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

  /// The one member `AuthService/Login` accepts here, mirroring the
  /// development seed (`db/seeds/dev/001_tenant_users.sql`), which also holds
  /// an access ticket for [paidEpisodeId].
  static const memberEmail = 'member@example.com';
  static const memberPassword = 'memberpass';
  static const memberName = 'Sample Member';
  static const memberPublicId = 'SeedMMBRAAA1';
  static const memberAccessToken = 'fixture-access-token';

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

  /// `GetEpisodeDetail` bodies served instead of [populatedEpisodes] once the
  /// request carries [activeAccessToken]: the paid episode is entitled and has
  /// pages, the way an access ticket makes it read for a signed-in member.
  static Map<String, Map<String, Object?>> populatedEntitledEpisodes() {
    return {
      paidEpisodeId: {
        'episode': {
          'publicId': paidEpisodeId,
          'title': 'Seed Episode 001-10',
          'orderIndex': 10,
          'price': 500,
        },
        'series': {'publicId': seedSeriesId, 'title': seedSeriesTitle},
        'access': 'EPISODE_ACCESS_ENTITLED',
        'images': [
          for (var page = 1; page <= seedEpisodePageCount; page++)
            {
              'id': '$paidEpisodeId-page-$page',
              'imageUrl': '/images/episodes/$paidEpisodeId-page-$page',
              'contentType': 'image/png',
              'displayOrder': page,
              'width': 800,
              'height': 1200,
            },
        ],
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

  /// The bodies a request carrying [activeAccessToken] gets instead, keyed the
  /// same way. An episode missing here answers from [episodes].
  Map<String, Map<String, Object?>> entitledEpisodes;
  int listStatus;
  int detailStatus;
  int episodeStatus;
  int tenantStatus;

  /// The bearer `GetMe` accepts and `GetEpisodeDetail` unlocks for. Set it to
  /// another value to act out a token the API has stopped accepting.
  String? activeAccessToken;
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

    if (path.endsWith('/Login')) {
      final body = await _readBody(request);
      if (body['email'] != memberEmail || body['password'] != memberPassword) {
        await _write(request, HttpStatus.unauthorized, {
          'code': 'unauthenticated',
          'message': 'invalid credentials',
        });
        return;
      }
      await _write(request, HttpStatus.ok, {
        'user': {
          'publicId': memberPublicId,
          'name': memberName,
          'role': 'member',
        },
        'accessToken': {
          'token': memberAccessToken,
          'expiresAt': DateTime.now()
              .toUtc()
              .add(const Duration(hours: 24))
              .toIso8601String(),
        },
      });
      return;
    }

    if (path.endsWith('/GetMe')) {
      await _readBody(request);
      if (!_isAuthorized(request)) {
        await _write(request, HttpStatus.unauthorized, {
          'code': 'unauthenticated',
          'message': 'invalid token',
        });
        return;
      }
      await _write(request, HttpStatus.ok, {
        'user': {
          'publicId': memberPublicId,
          'name': memberName,
          'role': 'member',
        },
      });
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
      final episode = _isAuthorized(request)
          ? entitledEpisodes[publicId] ?? episodes[publicId]
          : episodes[publicId];
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
    final body = await _readBody(request);
    return body['publicId'] as String? ?? '';
  }

  Future<Map<String, Object?>> _readBody(HttpRequest request) async {
    final raw = await utf8.decoder.bind(request).join();
    if (raw.trim().isEmpty) {
      return const {};
    }
    final decoded = jsonDecode(raw);
    return decoded is Map
        ? decoded.map((key, value) => MapEntry(key.toString(), value))
        : const {};
  }

  bool _isAuthorized(HttpRequest request) {
    final token = activeAccessToken;
    if (token == null || token.isEmpty) {
      return false;
    }
    return request.headers.value(HttpHeaders.authorizationHeader) ==
        'Bearer $token';
  }

  Future<void> _write(HttpRequest request, int status, Object body) async {
    request.response.statusCode = status;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode(body));
    await request.response.close();
  }
}
