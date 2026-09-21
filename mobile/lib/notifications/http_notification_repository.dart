import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
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

  static const _listProcedure =
      '/publira.v1.NotificationService/ListNotifications';
  static const _countProcedure =
      '/publira.v1.NotificationService/CountUnreadNotifications';
  static const _markProcedure =
      '/publira.v1.NotificationService/MarkNotificationAsRead';
  static const _markAllProcedure =
      '/publira.v1.NotificationService/MarkAllNotificationsAsRead';

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
    final body = await _call(_listProcedure, accessToken, {
      'limit': pageSize,
      if (token.isNotEmpty) 'token': token,
    });
    return InboxNotificationPage(
      notifications: _notifications(body['notifications']),
      nextToken: _readString(body, 'nextToken'),
    );
  }

  @override
  Future<int> countUnread() async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return 0;
    }
    final body = await _call(_countProcedure, accessToken, const {});
    // protojson omits a zero.
    final count = body['unreadCount'];
    return count is num ? count.toInt() : 0;
  }

  @override
  Future<void> markRead(String notificationId) async {
    await _call(_markProcedure, _requireSession(), {
      'notificationId': notificationId,
    });
  }

  @override
  Future<void> markAllRead() async {
    await _call(_markAllProcedure, _requireSession(), const {});
  }

  Future<Map<String, Object?>> _call(
    String procedure,
    String accessToken,
    Map<String, Object?> body,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      return await _client.unary(
        procedure,
        {
          ...body,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
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

  List<InboxNotification> _notifications(Object? raw) {
    // protojson omits an empty repeated field.
    if (raw == null) {
      return const [];
    }
    if (raw is! List) {
      throw const NotificationFailure(
        NotificationFailureKind.unexpected,
        message: 'notifications must be a list',
      );
    }
    final notifications = raw
        .whereType<Map<Object?, Object?>>()
        .map((item) => item.map((key, value) => MapEntry('$key', value)))
        .map(_notification)
        // A row with no id could never be marked read.
        .nonNulls
        .toList();
    return List<InboxNotification>.unmodifiable(notifications);
  }

  InboxNotification? _notification(Map<String, Object?> json) {
    final id = _readString(json, 'id');
    if (id.isEmpty) {
      return null;
    }
    return InboxNotification(
      id: id,
      kind: InboxNotificationKind.fromWire(
        _readString(json, 'notificationType'),
      ),
      payload: InboxNotificationPayload.parse(_readString(json, 'payload')),
      // protojson omits a false.
      isRead: json['isRead'] == true,
      createdAt: DateTime.tryParse(_readString(json, 'createdAt'))?.toLocal(),
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

  String _readString(Map<String, Object?> json, String key) {
    final value = json[key];
    return value is String ? value.trim() : '';
  }
}
