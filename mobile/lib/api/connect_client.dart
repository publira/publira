import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:publira/api/connect_exception.dart';

/// Reads the public-audience JWT the app holds right now.
///
/// Called once per request rather than captured at construction, so a sign-in
/// or a sign-out reaches the very next call without rebuilding the client.
typedef AccessTokenReader = String Function();

/// A unary answer together with its response headers, under lower-cased
/// names, for the one caller that has to read something beside the body.
typedef ConnectResponse = ({
  Map<String, Object?> body,
  Map<String, String> headers,
});

/// Minimal Connect JSON unary client for the public API.
///
/// Only the catalog/domain/auth RPCs this app needs are called. Field names
/// follow protojson camelCase (`publicId`, `tenantId`), matching connect-go.
class ConnectClient {
  ConnectClient({
    required this.baseUrl,
    http.Client? httpClient,
    this._accessToken,
    this.timeout = const Duration(seconds: 10),
  }) : _http = httpClient ?? http.Client();

  /// The origin the public API is served from, under `/api`.
  final String baseUrl;
  final Duration timeout;

  final AccessTokenReader? _accessToken;
  final http.Client _http;

  static const _tenantHeader = 'X-Publira-Tenant-Id';

  /// The JWT this client would send right now. Empty calls the API
  /// anonymously, which the public RPCs allow; a body that needs a purchase
  /// stays locked without it.
  String get accessToken => _accessToken?.call().trim() ?? '';

  /// Calls [procedure] with [body].
  ///
  /// [accessToken] replaces the client's own reader for this one call, which
  /// is how a stored token gets checked before the app adopts it.
  Future<Map<String, Object?>> unary(
    String procedure,
    Map<String, Object?> body, {
    String? tenantId,
    String? accessToken,
  }) async {
    final response = await exchange(
      procedure,
      body,
      tenantId: tenantId,
      accessToken: accessToken,
    );
    return response.body;
  }

  /// [unary] that also sends [headers] and hands back the response headers.
  Future<ConnectResponse> exchange(
    String procedure,
    Map<String, Object?> body, {
    String? tenantId,
    String? accessToken,
    Map<String, String> headers = const {},
  }) async {
    final uri = Uri.parse(baseUrl).replace(path: '/api$procedure');
    final requestHeaders = <String, String>{
      ...headers,
      'content-type': 'application/json',
      'connect-protocol-version': '1',
    };
    final trimmedTenant = tenantId?.trim() ?? '';
    if (trimmedTenant.isNotEmpty) {
      requestHeaders[_tenantHeader] = trimmedTenant;
    }
    final trimmedToken = (accessToken ?? this.accessToken).trim();
    if (trimmedToken.isNotEmpty) {
      requestHeaders['authorization'] = 'Bearer $trimmedToken';
    }

    late final http.Response response;
    try {
      response = await _http
          .post(uri, headers: requestHeaders, body: jsonEncode(body))
          .timeout(timeout);
    } on TimeoutException {
      throw const ConnectException(
        code: 'deadline_exceeded',
        message: 'request timed out',
      );
    } on IOException catch (error) {
      // Not only a refused socket: `IOClient` re-throws a TLS
      // `HandshakeException` as it is, and a call that never reached the API
      // is one the caller has to be able to answer from the device.
      throw ConnectException(code: 'unavailable', message: '$error');
    } on http.ClientException catch (error) {
      throw ConnectException(code: 'unavailable', message: error.message);
    }

    late final Map<String, Object?> decoded;
    try {
      decoded = _decodeBody(response.body);
    } on FormatException {
      throw ConnectException(
        code: _fallbackCode(response.statusCode),
        message: 'HTTP ${response.statusCode} returned a non-JSON response',
      );
    }
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return (body: decoded, headers: response.headers);
    }

    final responseCode = _readString(decoded, 'code');
    final responseMessage = _readString(decoded, 'message');
    throw ConnectException(
      code: responseCode.isEmpty
          ? _fallbackCode(response.statusCode)
          : responseCode,
      message: responseMessage.isEmpty
          ? 'HTTP ${response.statusCode}'
          : responseMessage,
    );
  }

  String _fallbackCode(int statusCode) {
    return statusCode >= 500 ? 'unavailable' : 'internal';
  }

  String _readString(Map<String, Object?> body, String key) {
    final value = body[key];
    return value is String ? value.trim() : '';
  }

  Map<String, Object?> _decodeBody(String raw) {
    if (raw.trim().isEmpty) {
      return const {};
    }
    final decoded = jsonDecode(raw);
    if (decoded is Map) {
      return decoded.map((key, value) => MapEntry(key.toString(), value));
    }
    throw const FormatException('response body is not a JSON object');
  }
}
