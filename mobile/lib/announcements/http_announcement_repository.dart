import 'package:publira/announcements/announcement_failure.dart';
import 'package:publira/announcements/announcement_repository.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/models/announcement.dart';

/// [AnnouncementRepository] backed by the announcement RPCs of
/// `publira.v1.AuthService`.
///
/// Each call reads the token once and sends it explicitly, so an answer is
/// always the one for the reader the call started for, even when another
/// signs in while the tenant lookup is in flight.
class HttpAnnouncementRepository implements AnnouncementRepository {
  const HttpAnnouncementRepository({
    required this._client,
    required this._tenants,
  });

  static const _listProcedure = '/publira.v1.AuthService/ListAnnouncements';
  static const _getProcedure = '/publira.v1.AuthService/GetAnnouncement';
  static const _pinnedProcedure =
      '/publira.v1.AuthService/GetPinnedAnnouncement';
  static const _markProcedure =
      '/publira.v1.AuthService/MarkAnnouncementAsRead';
  static const _markAllProcedure =
      '/publira.v1.AuthService/MarkAllAnnouncementsAsRead';

  /// Rows one page asks for. The API caps this at 100 and falls back to 20.
  static const pageSize = 20;

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<AnnouncementPage> list({String token = ''}) async {
    final body = await _call(_listProcedure, _client.accessToken, {
      'limit': pageSize,
      if (token.isNotEmpty) 'token': token,
    });
    return AnnouncementPage(
      announcements: _announcements(body['announcements']),
      nextToken: _readString(body, 'nextToken'),
    );
  }

  @override
  Future<Announcement> get(String announcementId) async {
    final body = await _call(_getProcedure, _client.accessToken, {
      'announcementId': announcementId,
    });
    final announcement = _announcementOf(body['announcement']);
    if (announcement == null) {
      throw const AnnouncementFailure(
        AnnouncementFailureKind.notFound,
        message: 'the response carries no announcement',
      );
    }
    return announcement;
  }

  /// Sent without the session: the answer is the same for every reader of
  /// the tenant, and a token the API has stopped taking would otherwise fail
  /// a banner that needs none.
  @override
  Future<Announcement?> pinned() async {
    final body = await _call(_pinnedProcedure, '', const {});
    return _announcementOf(body['announcement']);
  }

  @override
  Future<void> markRead(String announcementId) async {
    await _call(_markProcedure, _requireSession(), {
      'announcementId': announcementId,
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

  /// The token a read mark carries. Read state is offered only to a
  /// signed-in reader, so an empty token here is a session that ended since.
  String _requireSession() {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const AnnouncementFailure(
        AnnouncementFailureKind.sessionExpired,
        message: 'the app holds no session',
      );
    }
    return accessToken;
  }

  List<Announcement> _announcements(Object? raw) {
    // protojson omits an empty repeated field.
    if (raw == null) {
      return const [];
    }
    if (raw is! List) {
      throw const AnnouncementFailure(
        AnnouncementFailureKind.unexpected,
        message: 'announcements must be a list',
      );
    }
    return List<Announcement>.unmodifiable(raw.map(_announcementOf).nonNulls);
  }

  /// A row with no id is dropped: it could be neither opened nor marked read.
  Announcement? _announcementOf(Object? raw) {
    if (raw is! Map) {
      return null;
    }
    final json = raw.map((key, value) => MapEntry('$key', value));
    final id = _readString(json, 'id');
    if (id.isEmpty) {
      return null;
    }
    return Announcement(
      id: id,
      title: _readString(json, 'title'),
      body: _readString(json, 'body'),
      linkUrl: _readString(json, 'linkUrl'),
      // protojson omits a false.
      isRead: json['isRead'] == true,
      createdAt: _readInstant(json, 'createdAt'),
      pinnedUntil: _readInstant(json, 'pinnedUntil'),
    );
  }

  AnnouncementFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return AnnouncementFailure(
        AnnouncementFailureKind.network,
        message: error.message,
      );
    }
    return AnnouncementFailure(switch (error.code) {
      'unauthenticated' => AnnouncementFailureKind.sessionExpired,
      // A malformed id names no announcement either.
      'not_found' || 'invalid_argument' => AnnouncementFailureKind.notFound,
      _ => AnnouncementFailureKind.unexpected,
    }, message: error.message);
  }

  DateTime? _readInstant(Map<String, Object?> json, String key) =>
      DateTime.tryParse(_readString(json, key))?.toLocal();

  String _readString(Map<String, Object?> json, String key) {
    final value = json[key];
    return value is String ? value.trim() : '';
  }
}
