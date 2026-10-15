import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/notification.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/models/inbox_notification.dart';
import 'package:publira/notifications/notification_failure.dart';
import 'package:publira/notifications/notification_repository.dart';

/// [NotificationRepository] backed by `publira.v1.NotificationService`.
///
/// Each call reads the token once and sends it explicitly, so an answer is
/// always the one for the reader the call started for, even when another
/// signs in while the tenant lookup is in flight.
class HttpNotificationRepository implements NotificationRepository {
  const HttpNotificationRepository({
    required this._client,
    required this._tenants,
  });

  /// Rows one page asks for. The API caps this at 100 and falls back to 20.
  static const pageSize = 20;

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<InboxNotificationPage> list({String token = ''}) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return InboxNotificationPage.empty;
    }
    final body = await _call(
      accessToken,
      (api, call, tenant) => api.listNotifications(
        call,
        pb.ListNotificationsRequest(
          limit: pageSize,
          token: token.isEmpty ? null : token,
          surface: appClientSurface,
          tenant: tenant,
        ),
      ),
    );
    return InboxNotificationPage(
      notifications: List<InboxNotification>.unmodifiable(
        body.notifications
            .map(_notification)
            // A row with no id could never be marked read.
            .nonNulls,
      ),
      nextToken: body.nextToken.trim(),
    );
  }

  @override
  Future<int> countUnread() async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return 0;
    }
    final body = await _call(
      accessToken,
      (api, call, tenant) => api.countUnreadNotifications(
        call,
        pb.CountUnreadNotificationsRequest(
          surface: appClientSurface,
          tenant: tenant,
        ),
      ),
    );
    return body.unreadCount;
  }

  @override
  Future<void> markRead(String notificationId) async {
    await _call(
      _requireSession(),
      (api, call, tenant) => api.markNotificationAsRead(
        call,
        pb.MarkNotificationAsReadRequest(
          notificationId: notificationId,
          tenant: tenant,
        ),
      ),
    );
  }

  @override
  Future<void> markAllRead() async {
    await _call(
      _requireSession(),
      (api, call, tenant) => api.markAllNotificationsAsRead(
        call,
        pb.MarkAllNotificationsAsReadRequest(
          surface: appClientSurface,
          tenant: tenant,
        ),
      ),
    );
  }

  /// Makes the call [send] makes through `api`, as the reader [accessToken]
  /// signs in.
  Future<T> _call<T>(
    String accessToken,
    Future<T> Function(
      pb.NotificationServiceApi api,
      ConnectCallContext call,
      pb.TenantContext tenant,
    )
    send,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      return await send(
        pb.NotificationServiceApi(_client),
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.TenantContext(tenantId: tenantId),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// The token a read mark carries. The inbox is shown only to a signed-in
  /// reader, so an empty token here is a session that ended since.
  String _requireSession() {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const NotificationFailure(
        NotificationFailureKind.sessionExpired,
        message: 'the app holds no session',
      );
    }
    return accessToken;
  }

  InboxNotification? _notification(pb.NotificationItem item) {
    final id = item.id.trim();
    if (id.isEmpty) {
      return null;
    }
    return InboxNotification(
      id: id,
      kind: InboxNotificationKind.fromWire(item.notificationType),
      payload: InboxNotificationPayload.parse(item.payload),
      isRead: item.isRead,
      createdAt: DateTime.tryParse(item.createdAt.trim())?.toLocal(),
    );
  }

  NotificationFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return NotificationFailure(
        NotificationFailureKind.network,
        message: error.message,
      );
    }
    return NotificationFailure(
      error.code == 'unauthenticated'
          ? NotificationFailureKind.sessionExpired
          : NotificationFailureKind.unexpected,
      message: error.message,
    );
  }
}
