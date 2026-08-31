import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';

/// Resolves the tenant id behind the configured host and keeps it for the rest
/// of the run.
///
/// Every public RPC is tenant-scoped, so the first call of a session pays for
/// the lookup and the ones after it reuse the answer. A failed lookup is not
/// kept, so the next caller retries it.
class TenantResolver {
  TenantResolver({required ConnectClient client, required this.tenantHost})
    : _client = client;

  static const _procedure = '/publira.v1.DomainService/GetTenantByDomain';

  final String tenantHost;
  final ConnectClient _client;

  String? _tenantId;
  Future<String>? _pending;

  /// Throws [ConnectException] when the lookup fails or answers without an id.
  Future<String> resolve() {
    final cached = _tenantId;
    if (cached != null) {
      return Future.value(cached);
    }
    return _pending ??= _fetch();
  }

  Future<String> _fetch() async {
    try {
      final body = await _client.unary(_procedure, {
        'domains': [tenantHost],
      });
      // A value of another type is as unusable as a missing one, and reaches
      // the caller as the same Connect error rather than as a cast that no
      // repository is catching.
      final rawTenantId = body['tenantId'];
      final tenantId = rawTenantId is String ? rawTenantId.trim() : '';
      if (tenantId.isEmpty) {
        throw const ConnectException(
          code: 'internal',
          message: 'GetTenantByDomain returned no usable tenantId',
        );
      }
      _tenantId = tenantId;
      return tenantId;
    } catch (error) {
      _pending = null;
      rethrow;
    }
  }
}
