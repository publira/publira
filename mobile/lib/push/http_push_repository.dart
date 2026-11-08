import 'package:publira/api/connect_client.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/notification.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/push/push_repository.dart';

/// [PushRepository] backed by `publira.v1.NotificationService` on the public
/// API.
///
/// The client authorizes every call with whichever session the app holds, so a
/// registration always names the reader who is signed in at that moment.
class HttpPushRepository implements PushRepository {
  const HttpPushRepository({required this._client, required this._tenants});

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<void> register({
    required PushToken token,
    required PushPlatform platform,
  }) async {
    final tenantId = await _tenants.resolve();
    await pb.NotificationServiceApi(_client).registerPushDevice(
      ConnectCallContext(tenantId: tenantId),
      pb.RegisterPushDeviceRequest(
        tenant: pb.TenantContext(tenantId: tenantId),
        token: token.value,
        platform: switch (platform) {
          PushPlatform.ios => pb.PushPlatform.PUSH_PLATFORM_IOS,
          PushPlatform.android => pb.PushPlatform.PUSH_PLATFORM_ANDROID,
        },
        // A server release that predates the field skips it as unknown and
        // records the registration as a registration token, which FCM still
        // delivers an installation ID to while `message.token` lasts.
        tokenType: switch (token.type) {
          PushTokenType.registrationToken =>
            pb.PushTokenType.PUSH_TOKEN_TYPE_REGISTRATION_TOKEN,
          PushTokenType.installationId =>
            pb.PushTokenType.PUSH_TOKEN_TYPE_INSTALLATION_ID,
        },
      ),
    );
  }

  @override
  Future<void> unregister(String token) async {
    final tenantId = await _tenants.resolve();
    await pb.NotificationServiceApi(_client).unregisterPushDevice(
      ConnectCallContext(tenantId: tenantId),
      pb.UnregisterPushDeviceRequest(
        tenant: pb.TenantContext(tenantId: tenantId),
        token: token,
      ),
    );
  }
}
