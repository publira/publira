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
  const HttpContentViewRepository({
    required this._client,
    required this._tenants,
    required this._anonymousIds,
  });

  static const _procedure = '/publira.v1.ContentViewService/RecordContentView';
  static const _cookieName = 'publira_aid';

  final ConnectClient _client;
  final TenantResolver _tenants;
  final AnonymousIdStore _anonymousIds;

  @override
  Future<void> record(ContentViewKind kind, String publicId) async {
    final tenantId = await _tenants.resolve();
    final anonymousId = await _anonymousIds.read();
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
    // A browser keeps a Secure cookie away from plain HTTP, and so does this:
    // what is kept is only ever sent back to the origin it came from.
    if (minted != null && (_secure || !minted.secure)) {
      await _anonymousIds.write(minted.value);
    }
  }

  bool get _secure => Uri.parse(_client.baseUrl).isScheme('https');

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
