import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/push/push_repository.dart';

/// [PushRepository] backed by `publira.v1.NotificationService` on the public
/// API.
///
/// The client authorizes every call with whichever session the app holds, so a
/// registration always names the reader who is signed in at that moment.
class HttpPushRepository implements PushRepository {
  const HttpPushRepository({
    required ConnectClient client,
    required TenantResolver tenants,
  }) : _client = client,
       _tenants = tenants;

  static const _registerProcedure =
      '/publira.v1.NotificationService/RegisterPushDevice';
  static const _unregisterProcedure =
      '/publira.v1.NotificationService/UnregisterPushDevice';

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<void> register({
    required String token,
    required PushPlatform platform,
  }) async {
    final tenantId = await _tenants.resolve();
    await _client.unary(_registerProcedure, {
      'tenant': {'tenantId': tenantId},
      'token': token,
      'platform': platform.wireValue,
    }, tenantId: tenantId);
  }

  @override
  Future<void> unregister(String token) async {
    final tenantId = await _tenants.resolve();
    await _client.unary(_unregisterProcedure, {
      'tenant': {'tenantId': tenantId},
      'token': token,
    }, tenantId: tenantId);
  }
}
