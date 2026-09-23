import 'dart:io';

import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/content_views/anonymous_id_store.dart';
import 'package:publira/content_views/content_view_repository.dart';

/// [ContentViewRepository] backed by `publira.v1.ContentViewService`.
///
/// A signed-in reader is attributed by the bearer the client sends. A
/// signed-out one is attributed by the `publira_aid` cookie, which the API
/// mints on the first view that carries neither; the app has no cookie jar, so
/// this keeps the minted value in [AnonymousIdStore] and sends it back itself.
class HttpContentViewRepository implements ContentViewRepository {
  HttpContentViewRepository({
    required this._client,
    required this._tenants,
    required this._anonymousIds,
    this._now = DateTime.now,
  });

  static const _procedure = '/publira.v1.ContentViewService/RecordContentView';
  static const _cookieName = 'publira_aid';

  final ConnectClient _client;
  final TenantResolver _tenants;
  final AnonymousIdStore _anonymousIds;
  final DateTime Function() _now;

  /// The view in flight. Views are sent one at a time, so a view sent while
  /// the first one is still being minted an identifier carries that identifier
  /// rather than being minted one of its own.
  Future<void> _tail = Future.value();

  @override
  Future<void> record(ContentViewKind kind, String publicId) {
    final sent = _tail.then((_) => _send(kind, publicId));
    _tail = sent.then<void>((_) {}, onError: (Object _) {});
    return sent;
  }

  Future<void> _send(ContentViewKind kind, String publicId) async {
    final tenantId = await _tenants.resolve();
    final stored = await _anonymousIds.read();
    final anonymousId = stored != null && stored.isLiveAt(_now())
        ? stored.value
        : '';
    final response = await _client.exchange(
      _procedure,
      {
        'tenant': {'tenantId': tenantId},
        'target': {'type': kind.wireValue, 'publicId': publicId},
        'surface': appClientSurface,
      },
      tenantId: tenantId,
      headers: {
        if (anonymousId.isNotEmpty)
          HttpHeaders.cookieHeader: '$_cookieName=$anonymousId',
      },
    );
    final minted = _mintedCookie(response.headers[HttpHeaders.setCookieHeader]);
    if (minted == null) {
      return;
    }
    // A browser keeps a Secure cookie away from plain HTTP, and so does this:
    // what is kept is only ever sent back to the origin it came from.
    final expiresAt = _expiry(minted);
    if (expiresAt != null && (_secure || !minted.secure)) {
      await _anonymousIds.write(
        AnonymousId(value: minted.value, expiresAt: expiresAt),
      );
    }
  }

  bool get _secure => Uri.parse(_client.baseUrl).isScheme('https');

  /// When [cookie] expires, `null` for a cookie that lasts only as long as a
  /// browser session, which the app has no counterpart of.
  DateTime? _expiry(Cookie cookie) {
    final maxAge = cookie.maxAge;
    if (maxAge != null) {
      return _now().add(Duration(seconds: maxAge));
    }
    return cookie.expires;
  }

  /// The `publira_aid` cookie among the response's `Set-Cookie` values, which
  /// `package:http` joins into one header with commas.
  Cookie? _mintedCookie(String? header) {
    if (header == null) {
      return null;
    }
    for (final value in header.split(RegExp(r',(?=\s*[^\s;=,]+=)'))) {
      try {
        final cookie = Cookie.fromSetCookieValue(value.trim());
        if (cookie.name == _cookieName && cookie.value.isNotEmpty) {
          return cookie;
        }
      } on FormatException {
        // Another cookie this does not read.
      }
    }
    return null;
  }
}
