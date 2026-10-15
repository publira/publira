import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:protobuf/protobuf.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/api/unknown_enum.dart';
import 'package:publira/tenant/tenant_availability.dart';

/// Reads the public-audience JWT the app holds right now.
///
/// Called once per request rather than captured at construction, so a sign-in
/// or a sign-out reaches the very next call without rebuilding the client.
typedef AccessTokenReader = String Function();

/// What one call sends beside its message, and what it hands back beside the
/// answer: the generated `*ServiceApi` stubs take it as their context.
class ConnectCallContext extends ClientContext {
  ConnectCallContext({
    this.tenantId,
    this.accessToken,
    this.headers = const {},
    super.timeout,
  });

  /// Sent as `X-Publira-Tenant-Id`. Every public RPC but the domain lookup
  /// names the tenant it is about.
  final String? tenantId;

  /// Replaces the client's own reader for this one call, which is how a
  /// stored token gets checked before the app adopts it.
  final String? accessToken;

  /// Sent beside the Connect headers.
  final Map<String, String> headers;

  /// The answer's headers, under lower-cased names, once the call has been
  /// answered.
  Map<String, String> responseHeaders = const {};
}

/// Connect unary client for the public API, speaking the binary protobuf
/// codec.
///
/// The repositories call it through the `*ServiceApi` stubs `buf generate`
/// writes into `lib/api/gen/` from `proto/`, so a request and an answer are
/// the generated messages, written and read in the protobuf wire format,
/// which connect-go answers every handler in.
///
/// A refusal is JSON whichever codec the request used: the Connect protocol
/// writes a unary error as its own envelope rather than as a message.
class ConnectClient implements RpcClient {
  ConnectClient({
    required this.baseUrl,
    http.Client? httpClient,
    this._accessToken,
    this._availability,
    this._onLegalPageAgreementRequired,
    this.timeout = const Duration(seconds: 10),
  }) : _http = httpClient ?? http.Client();

  /// The origin the public API is served from, under `/rpc`.
  final String baseUrl;
  final Duration timeout;

  final AccessTokenReader? _accessToken;

  /// Told of every answer, so the app learns that the tenant has been
  /// suspended, and that it has been resumed, from whichever request comes
  /// first. Every public RPC names the tenant, so any answer is about it.
  final TenantAvailability? _availability;

  /// Told of every refusal that names a legal page agreement the reader owes,
  /// so the app asks for it from whichever request the API refused first,
  /// rather than each screen reporting the refusal as a failure of its own.
  final void Function()? _onLegalPageAgreementRequired;

  final http.Client _http;

  static const _tenantHeader = 'X-Publira-Tenant-Id';

  /// The content type of the binary protobuf codec, which a Connect unary
  /// request names and a success answers with.
  static const _protoContentType = 'application/proto';

  /// The package of every service the stubs name: `buf.gen.yaml` generates
  /// `publira.v1` alone for the app, and a stub passes its service by its
  /// short name.
  static const _package = 'publira.v1';

  /// The JWT this client would send right now. Empty calls the API
  /// anonymously, which the public RPCs allow; a body that needs a purchase
  /// stays locked without it.
  String get accessToken => _accessToken?.call().trim() ?? '';

  /// Calls [methodName] of [serviceName] with [request] and merges the answer
  /// into [emptyResponse].
  ///
  /// [ctx] is a [ConnectCallContext] for a call that names a tenant, a token
  /// of its own, or headers, and its timeout replaces the client's own for a
  /// call that carries more than a few fields, such as an image.
  @override
  Future<T> invoke<T extends GeneratedMessage>(
    ClientContext? ctx,
    String serviceName,
    String methodName,
    GeneratedMessage request,
    T emptyResponse,
  ) async {
    final call = ctx is ConnectCallContext ? ctx : null;
    final uri = Uri.parse(
      baseUrl,
    ).replace(path: '/rpc/$_package.$serviceName/$methodName');
    final requestHeaders = <String, String>{
      ...?call?.headers,
      'content-type': _protoContentType,
      'connect-protocol-version': '1',
    };
    final trimmedTenant = call?.tenantId?.trim() ?? '';
    if (trimmedTenant.isNotEmpty) {
      requestHeaders[_tenantHeader] = trimmedTenant;
    }
    final trimmedToken = (call?.accessToken ?? accessToken).trim();
    if (trimmedToken.isNotEmpty) {
      requestHeaders['authorization'] = 'Bearer $trimmedToken';
    }

    late final http.Response response;
    try {
      response = await _http
          .post(uri, headers: requestHeaders, body: request.writeToBuffer())
          .timeout(ctx?.timeout ?? timeout);
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

    if (response.statusCode >= 200 && response.statusCode < 300) {
      _availability?.reportServed();
      call?.responseHeaders = response.headers;
      return _decodeMessage(response, emptyResponse);
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
    final responseCode = _readString(decoded, 'code');
    final responseMessage = _readString(decoded, 'message');
    final error = ConnectException(
      code: responseCode.isEmpty
          ? _fallbackCode(response.statusCode)
          : responseCode,
      message: responseMessage.isEmpty
          ? 'HTTP ${response.statusCode}'
          : responseMessage,
      fieldViolations: fieldViolationsOf(decoded['details']),
      reasons: errorReasonsOf(decoded['details']),
    );
    if (error.isTenantSuspended) {
      _availability?.reportSuspended();
    }
    if (error.isLegalPageAgreementRequired) {
      _onLegalPageAgreementRequired?.call();
    }
    throw error;
  }

  /// Merges the binary success body of [response] into [emptyResponse].
  ///
  /// A field this build does not know is kept in
  /// [GeneratedMessage.unknownFields] rather than failing the call, so a
  /// server that has grown a field still answers an older app, and so is an
  /// enum value this build does not know, which [carriesUnknownEnum] reads.
  /// An empty body is the empty message.
  T _decodeMessage<T extends GeneratedMessage>(
    http.Response response,
    T emptyResponse,
  ) {
    // A success in another codec is not a message this client can read, and
    // a page some proxy answered in the API's place could otherwise decode
    // into a message that merely looks wrong.
    final contentType = response.headers['content-type'] ?? '';
    if (contentType.split(';').first.trim().toLowerCase() !=
        _protoContentType) {
      throw ConnectException(
        code: 'internal',
        message: 'HTTP ${response.statusCode} returned "$contentType"',
      );
    }
    try {
      return emptyResponse..mergeFromBuffer(response.bodyBytes);
    } on InvalidProtocolBufferException catch (error) {
      // A body that does not decode reaches the caller as a Connect error
      // rather than as an exception no repository is catching.
      throw ConnectException(code: 'internal', message: error.message);
    }
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
