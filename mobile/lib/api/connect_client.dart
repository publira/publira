import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:protobuf/protobuf.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/api/retry_after.dart';
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

/// Connect client for the public API, speaking the binary protobuf codec.
///
/// The repositories call it through the `*ServiceApi` stubs `buf generate`
/// writes into `lib/api/gen/` from `proto/`, so a request and an answer are
/// the generated messages, written and read in the protobuf wire format,
/// which connect-go answers every handler in. A server-streaming method is
/// called through [serverStream] instead, because the stubs call every method
/// as unary.
///
/// A refusal is JSON whichever codec the request used: the Connect protocol
/// writes a unary error as its own envelope rather than as a message, and a
/// streaming one as the last envelope of the stream.
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

  /// The content type of the same codec in the Connect protocol's streaming
  /// form, whose request and answer are enveloped messages.
  static const _streamContentType = 'application/connect+proto';

  /// The flags of an envelope: a compressed message, which this client never
  /// asks for, and the end of the stream, whose payload is JSON.
  static const _compressedFlag = 0x01;
  static const _endStreamFlag = 0x02;

  /// An envelope's flags byte and the big-endian length of its payload.
  static const _envelopePrefixLength = 5;

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
    final uri = _procedureUri(serviceName, methodName);
    final requestHeaders = _requestHeaders(call, _protoContentType);

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

    throw _reported(
      _httpRefusal(response.statusCode, response.headers, response.body),
    );
  }

  /// Calls the server-streaming [methodName] of [serviceName] with [request]
  /// and yields each message of the answer, merged into a fresh one from
  /// [createResponse], in the order the API sends them.
  ///
  /// The request and every message of the answer are enveloped, as the
  /// Connect protocol's streaming form has them. A refusal arrives as the last
  /// envelope, whether the API sent it before the first message or after one,
  /// and is thrown as a [ConnectException] read the way a unary refusal is; a
  /// stream that ends without that last envelope was cut off, and is thrown
  /// as `unavailable`.
  ///
  /// The client's timeout, or [ctx]'s, bounds the wait for the answer to start
  /// and then each wait for the next piece of it, so a long answer that keeps
  /// arriving is never cut short. Cancelling the subscription ends the call.
  Stream<T> serverStream<T extends GeneratedMessage>(
    ConnectCallContext? ctx,
    String serviceName,
    String methodName,
    GeneratedMessage request,
    T Function() createResponse,
  ) async* {
    final message = request.writeToBuffer();
    final envelope = Uint8List(_envelopePrefixLength + message.length);
    ByteData.sublistView(envelope).setUint32(1, message.length);
    envelope.setAll(_envelopePrefixLength, message);
    final outgoing =
        http.Request('POST', _procedureUri(serviceName, methodName))
          ..headers.addAll(_requestHeaders(ctx, _streamContentType))
          ..bodyBytes = envelope;
    final wait = ctx?.timeout ?? timeout;

    late final http.StreamedResponse response;
    try {
      response = await _http.send(outgoing).timeout(wait);
    } on TimeoutException {
      throw const ConnectException(
        code: 'deadline_exceeded',
        message: 'request timed out',
      );
    } on IOException catch (error) {
      throw ConnectException(code: 'unavailable', message: '$error');
    } on http.ClientException catch (error) {
      throw ConnectException(code: 'unavailable', message: error.message);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      // An edge, or connect-go refusing the request before any handler ran,
      // answers with a status of its own and a unary-shaped body.
      final String body;
      try {
        body = await response.stream.bytesToString().timeout(wait);
      } on Object {
        throw ConnectException(
          code: _fallbackCode(response.statusCode),
          message: 'HTTP ${response.statusCode}',
          retryAfter: retryAfterOf(response.headers),
        );
      }
      throw _reported(
        _httpRefusal(response.statusCode, response.headers, body),
      );
    }
    final contentType = response.headers['content-type'] ?? '';
    if (contentType.split(';').first.trim().toLowerCase() !=
        _streamContentType) {
      throw ConnectException(
        code: 'internal',
        message: 'HTTP ${response.statusCode} returned "$contentType"',
      );
    }
    ctx?.responseHeaders = response.headers;

    var pending = Uint8List(0);
    try {
      await for (final chunk in response.stream.timeout(wait)) {
        pending = pending.isEmpty
            ? Uint8List.fromList(chunk)
            : (BytesBuilder(copy: false)
                    ..add(pending)
                    ..add(chunk))
                  .takeBytes();
        while (pending.length >= _envelopePrefixLength) {
          final length = ByteData.sublistView(pending).getUint32(1);
          final end = _envelopePrefixLength + length;
          if (pending.length < end) {
            break;
          }
          final flags = pending[0];
          final payload = Uint8List.sublistView(
            pending,
            _envelopePrefixLength,
            end,
          );
          pending = Uint8List.sublistView(pending, end);
          if (flags & _endStreamFlag != 0) {
            _endStream(payload, response.headers);
            return;
          }
          if (flags & _compressedFlag != 0) {
            throw const ConnectException(
              code: 'internal',
              message: 'the stream sent a compressed message',
            );
          }
          final decoded = _decodePayload(payload, createResponse());
          _availability?.reportServed();
          yield decoded;
        }
      }
    } on TimeoutException {
      throw const ConnectException(
        code: 'deadline_exceeded',
        message: 'the stream stopped arriving',
      );
    } on IOException catch (error) {
      throw ConnectException(code: 'unavailable', message: '$error');
    } on http.ClientException catch (error) {
      throw ConnectException(code: 'unavailable', message: error.message);
    }
    throw const ConnectException(
      code: 'unavailable',
      message: 'the stream ended before its end-of-stream message',
    );
  }

  Uri _procedureUri(String serviceName, String methodName) => Uri.parse(
    baseUrl,
  ).replace(path: '/rpc/$_package.$serviceName/$methodName');

  /// The headers a call to the public API sends, the body named as
  /// [contentType].
  Map<String, String> _requestHeaders(
    ConnectCallContext? call,
    String contentType,
  ) {
    final headers = <String, String>{
      ...?call?.headers,
      'content-type': contentType,
      'connect-protocol-version': '1',
    };
    final trimmedTenant = call?.tenantId?.trim() ?? '';
    if (trimmedTenant.isNotEmpty) {
      headers[_tenantHeader] = trimmedTenant;
    }
    final trimmedToken = (call?.accessToken ?? accessToken).trim();
    if (trimmedToken.isNotEmpty) {
      headers['authorization'] = 'Bearer $trimmedToken';
    }
    return headers;
  }

  /// The refusal an answer with a status outside 2xx carries in [body].
  ConnectException _httpRefusal(
    int statusCode,
    Map<String, String> headers,
    String body,
  ) {
    // Connect writes a refusal's metadata as headers of the answer, so the
    // wait reads the same off the API's own envelope and off an edge's page.
    final retryAfter = retryAfterOf(headers);
    late final Map<String, Object?> decoded;
    try {
      decoded = _decodeBody(body);
    } on FormatException {
      return ConnectException(
        code: _fallbackCode(statusCode),
        message: 'HTTP $statusCode returned a non-JSON response',
        retryAfter: retryAfter,
      );
    }
    return _refusal(
      decoded,
      fallbackCode: _fallbackCode(statusCode),
      fallbackMessage: 'HTTP $statusCode',
      retryAfter: retryAfter,
    );
  }

  /// The refusal a Connect error object [error] words.
  ConnectException _refusal(
    Map<String, Object?> error, {
    required String fallbackCode,
    required String fallbackMessage,
    Duration? retryAfter,
  }) {
    final code = _readString(error, 'code');
    final message = _readString(error, 'message');
    return ConnectException(
      code: code.isEmpty ? fallbackCode : code,
      message: message.isEmpty ? fallbackMessage : message,
      fieldViolations: fieldViolationsOf(error['details']),
      reasons: errorReasonsOf(error['details']),
      retryAfter: retryAfter,
    );
  }

  /// Tells whoever listens of what [error] says about the tenant and the
  /// reader, and hands it back to be thrown.
  ConnectException _reported(ConnectException error) {
    if (error.isTenantSuspended) {
      _availability?.reportSuspended();
    }
    if (error.isLegalPageAgreementRequired) {
      _onLegalPageAgreementRequired?.call();
    }
    return error;
  }

  /// Reads the end-of-stream message [payload], and throws the refusal it
  /// carries, if any.
  ///
  /// A streaming refusal's metadata travels in the message rather than as
  /// headers, since the headers went out before it, so its wait is read from
  /// there before the answer's headers.
  void _endStream(Uint8List payload, Map<String, String> headers) {
    late final Map<String, Object?> end;
    try {
      end = _decodeBody(utf8.decode(payload));
    } on FormatException {
      throw const ConnectException(
        code: 'internal',
        message: 'the end-of-stream message is not a JSON object',
      );
    }
    final error = end['error'];
    if (error is! Map) {
      _availability?.reportServed();
      return;
    }
    final metadata = end['metadata'];
    final retryAfter = metadata is Map && metadata['retry-after'] is List
        ? retryAfterOf({
            'retry-after': (metadata['retry-after'] as List).join(','),
          })
        : retryAfterOf(headers);
    throw _reported(
      _refusal(
        error.map((key, value) => MapEntry(key.toString(), value)),
        fallbackCode: 'unknown',
        fallbackMessage: 'the stream ended with an error',
        retryAfter: retryAfter,
      ),
    );
  }

  /// Merges one message of a stream into [emptyResponse], keeping what this
  /// build does not know as [_decodeMessage] does.
  T _decodePayload<T extends GeneratedMessage>(
    Uint8List payload,
    T emptyResponse,
  ) {
    try {
      return emptyResponse..mergeFromBuffer(payload);
    } on InvalidProtocolBufferException catch (error) {
      throw ConnectException(code: 'internal', message: error.message);
    }
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

  /// The code of a refusal whose body names none, read from its status.
  ///
  /// A 429 is `resource_exhausted`, the code Connect answers with that status,
  /// because a rate limit in front of the API — a sample proxy, a WAF, a CDN —
  /// refuses with a body of its own, and the repositories already tell the
  /// reader to slow down on that code.
  String _fallbackCode(int statusCode) {
    if (statusCode == HttpStatus.tooManyRequests) {
      return 'resource_exhausted';
    }
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
