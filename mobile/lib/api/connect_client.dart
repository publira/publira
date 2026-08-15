import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:publira/api/connect_exception.dart';

/// Minimal Connect JSON unary client for the public API.
///
/// Only the catalog/domain RPCs this app needs are called. Field names follow
/// protojson camelCase (`publicId`, `tenantId`), matching connect-go.
class ConnectClient {
  ConnectClient({
    required this.baseUrl,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 10),
  }) : _http = httpClient ?? http.Client();

  final String baseUrl;
  final Duration timeout;
  final http.Client _http;

  static const _tenantHeader = 'X-Publira-Tenant-Id';

  Future<Map<String, Object?>> unary(
    String procedure,
    Map<String, Object?> body, {
    String? tenantId,
  }) async {
    final uri = Uri.parse(baseUrl).resolve(procedure);
    final headers = <String, String>{
      'content-type': 'application/json',
      'connect-protocol-version': '1',
    };
    final trimmedTenant = tenantId?.trim() ?? '';
    if (trimmedTenant.isNotEmpty) {
      headers[_tenantHeader] = trimmedTenant;
    }

    late final http.Response response;
    try {
      response = await _http
          .post(uri, headers: headers, body: jsonEncode(body))
          .timeout(timeout);
    } on TimeoutException {
      throw const ConnectException(
        code: 'deadline_exceeded',
        message: 'request timed out',
      );
    } on SocketException catch (error) {
      throw ConnectException(code: 'unavailable', message: error.message);
    } on http.ClientException catch (error) {
      throw ConnectException(code: 'unavailable', message: error.message);
    }

    final decoded = _decodeBody(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }

    throw ConnectException(
      code: (decoded['code'] as String?)?.trim() ?? '',
      message: (decoded['message'] as String?)?.trim() ?? response.body,
    );
  }

  Map<String, Object?> _decodeBody(String raw) {
    if (raw.trim().isEmpty) {
      return const {};
    }
    final decoded = jsonDecode(raw);
    if (decoded is Map<String, Object?>) {
      return decoded;
    }
    if (decoded is Map) {
      return decoded.map((key, value) => MapEntry(key.toString(), value));
    }
    return const {};
  }
}
