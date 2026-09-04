import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:publira/api/image_cipher.dart';

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
    this.encryptImages = true,
    this.listResponse,
    this.detailResponse,
    this.episodeResponse,
    this.tenantResponse,
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

  /// Unsigned JWT whose `sub` is [memberPublicId]. It is shaped like the real
  /// public-audience token because image-server derives a page's content key
  /// from the token itself, so a fixture that is not a JWT could not be
  /// decrypted by the reader.
  static const memberAccessToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      '.eyJzdWIiOiJTZWVkTU1CUkFBQTEifQ'
      '.fixture-signature';

  /// Unsigned JWT whose `sub` is the synthetic subject a free body's media
  /// token carries (`server/internal/auth`.`FreeEpisodeMediaSubject`). The API
  /// puts one of these on every free page's URL, and it is the whole of the
  /// material a signed-out reader decrypts with.
  static const freeEpisodeMediaToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      '.eyJzdWIiOiJhbm9ueW1vdXMtZnJlZS1lcGlzb2RlIn0'
      '.fixture-signature';

  /// Another token for the same subject, standing in for the one image-server
  /// recomputes for the current rotation window. It is never handed out, so a
  /// page encrypted under it is a page the request cannot read.
  static const _currentWindowMediaToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      '.eyJzdWIiOiJhbm9ueW1vdXMtZnJlZS1lcGlzb2RlIiwiaWF0IjoxfQ'
      '.fixture-signature';

  /// Subject both free-path tokens carry
  /// (`server/internal/auth`.`FreeEpisodeMediaSubject`).
  static const freeEpisodeMediaSubject = 'anonymous-free-episode';

  /// Key id the fixture reports for an encrypted page, standing in for
  /// image-server's per-rendition cache key.
  static const imageKeyId = 'fixture-image-key';

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
              'imageUrl':
                  '/images/episodes/$seedEpisodeId-page-$page'
                  '?$mediaTokenQueryParam=$freeEpisodeMediaToken',
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

  /// Whether a page leaves as ciphertext. Set it to false to act out an
  /// image-server instance a rolling deploy has not replaced yet, which the
  /// reader still has to work against for the length of the rollout.
  bool encryptImages;

  /// Replace the whole body of the matching RPC, whichever status the RPC is
  /// answering with, so a test can send a shape the client is not expecting or
  /// an error code other than the default `unavailable`.
  Object? listResponse;
  Object? detailResponse;
  Object? episodeResponse;

  /// Replaces the whole `GetTenantByDomain` body, so a test can answer with a
  /// shape the client is not expecting.
  Object? tenantResponse;

  /// Headers of the last `GET /images/...` request, so a test can assert what
  /// the reader sends to image-server.
  HttpHeaders? lastImageRequestHeaders;

  /// Every Connect request answered so far, in order. A test reads it to
  /// assert what the client sent, and how many times it sent it.
  final List<RecordedRequest> requests = <RecordedRequest>[];

  /// The recorded requests whose path ends in [procedure], such as
  /// `GetTenantByDomain`.
  Iterable<RecordedRequest> requestsTo(String procedure) =>
      requests.where((request) => request.path.endsWith('/$procedure'));

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
      await _writeImage(request);
      return;
    }
    if (request.method != 'POST') {
      request.response.statusCode = HttpStatus.methodNotAllowed;
      await request.response.close();
      return;
    }

    final body = await _readBody(request);
    requests.add(
      RecordedRequest(
        path: path,
        headers: _snapshotHeaders(request.headers),
        body: body,
      ),
    );

    if (path.endsWith('/GetTenantByDomain')) {
      await _write(
        request,
        tenantStatus,
        tenantResponse ??
            {
              if (tenantStatus == HttpStatus.ok) 'tenantId': tenantId,
              if (tenantStatus != HttpStatus.ok) 'code': 'not_found',
              if (tenantStatus != HttpStatus.ok) 'message': 'tenant not found',
            },
      );
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
        await _write(
          request,
          detailStatus,
          detailResponse ??
              const {'code': 'unavailable', 'message': 'unavailable'},
        );
        return;
      }
      final publicId = _publicIdOf(body);
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
        await _write(
          request,
          episodeStatus,
          episodeResponse ??
              const {'code': 'unavailable', 'message': 'unavailable'},
        );
        return;
      }
      final publicId = _publicIdOf(body);
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

  String _publicIdOf(Map<String, Object?> body) {
    return body['publicId'] as String? ?? '';
  }

  Map<String, String> _snapshotHeaders(HttpHeaders headers) {
    final snapshot = <String, String>{};
    headers.forEach((name, values) {
      snapshot[name.toLowerCase()] = values.join(', ');
    });
    return snapshot;
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

  /// Answers a page the way image-server does.
  ///
  /// With [encryptImages] on, a page always leaves as ciphertext; only the
  /// material it is keyed to depends on the request. The PNG itself is what
  /// the flag being off looks like, and nothing else produces it.
  Future<void> _writeImage(HttpRequest request) async {
    request.response.statusCode = HttpStatus.ok;
    if (!encryptImages) {
      request.response.headers.contentType = ContentType('image', 'png');
      request.response.add(pageBytes);
      await request.response.close();
      return;
    }
    final (token, subject) = _imageCipherMaterial(request);

    request.response.headers
      ..contentType = ContentType('application', 'octet-stream')
      ..set(imageEncryptionHeader, imageEncryptionAlgorithm)
      ..set(imageContentTypeHeader, 'image/png')
      ..set(imageKeyIdHeader, imageKeyId);
    // The stream is its own inverse, so encrypting is the same call the
    // reader makes to decrypt.
    request.response.add(
      decryptImageBytes(
        ciphertext: pageBytes,
        keyId: imageKeyId,
        subject: subject,
        token: token,
      ),
    );
    await request.response.close();
  }

  /// The token and subject image-server would derive this page's key from.
  ///
  /// The request's own material is resolved in the server's order — the
  /// `Authorization` bearer first, then the media token on the URL, which is
  /// what a free page hands a reader with no session — and a value the server
  /// could not read is not material, so it falls through. Presenting nothing
  /// readable is not a way to be sent a plaintext page: the response is keyed
  /// to the window token instead, which this request was never handed.
  (String, String) _imageCipherMaterial(HttpRequest request) {
    final authorization =
        request.headers.value(HttpHeaders.authorizationHeader) ?? '';
    if (authorization.startsWith('Bearer ')) {
      final bearer = authorization.substring('Bearer '.length).trim();
      final subject = subjectFromJwt(bearer);
      if (subject != null) {
        return (bearer, subject);
      }
    }
    final mediaToken =
        request.uri.queryParameters[mediaTokenQueryParam]?.trim() ?? '';
    final subject = subjectFromJwt(mediaToken);
    if (subject != null) {
      return (mediaToken, subject);
    }
    return (_currentWindowMediaToken, freeEpisodeMediaSubject);
  }

  Future<void> _write(HttpRequest request, int status, Object body) async {
    request.response.statusCode = status;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode(body));
    await request.response.close();
  }
}

/// One Connect request [ConnectFixtureServer] answered, kept so a test can
/// assert what the client sent and not only what it did with the answer.
class RecordedRequest {
  const RecordedRequest({
    required this.path,
    required this.headers,
    required this.body,
  });

  /// Request path, ending in the Connect procedure name.
  final String path;

  /// Request headers, under lower-cased names.
  final Map<String, String> headers;

  /// Decoded JSON request body, empty when the request carried none.
  final Map<String, Object?> body;
}
