import 'package:publira/announcements/announcement_failure.dart';
import 'package:publira/announcements/announcement_repository.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/auth.pb.dart' as pb;
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

  /// Rows one page asks for. The API caps this at 100 and falls back to 20.
  static const pageSize = 20;

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<AnnouncementPage> list({
    String token = '',
    required String locale,
  }) async {
    final body = await _call(
      _client.accessToken,
      (api, call, tenant) => api.listAnnouncements(
        call,
        pb.ListAnnouncementsRequest(
          limit: pageSize,
          token: token.isEmpty ? null : token,
          locale: locale,
          tenant: tenant,
        ),
      ),
    );
    return AnnouncementPage(
      announcements: List<Announcement>.unmodifiable(
        body.announcements.map(_announcementOf).nonNulls,
      ),
      nextToken: body.nextToken.trim(),
    );
  }

  @override
  Future<Announcement> get(
    String announcementId, {
    required String locale,
  }) async {
    final body = await _call(
      _client.accessToken,
      (api, call, tenant) => api.getAnnouncement(
        call,
        pb.GetAnnouncementRequest(
          announcementId: announcementId,
          locale: locale,
          tenant: tenant,
        ),
      ),
    );
    final announcement = _announcementOf(body.announcement);
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
  Future<Announcement?> pinned({required String locale}) async {
    final body = await _call(
      '',
      (api, call, tenant) => api.getPinnedAnnouncement(
        call,
        pb.GetPinnedAnnouncementRequest(locale: locale, tenant: tenant),
      ),
    );
    return _announcementOf(body.announcement);
  }

  @override
  Future<void> markRead(String announcementId) async {
    await _call(
      _requireSession(),
      (api, call, tenant) => api.markAnnouncementAsRead(
        call,
        pb.MarkAnnouncementAsReadRequest(
          announcementId: announcementId,
          tenant: tenant,
        ),
      ),
    );
  }

  @override
  Future<void> markAllRead() async {
    await _call(
      _requireSession(),
      (api, call, tenant) => api.markAllAnnouncementsAsRead(
        call,
        pb.MarkAllAnnouncementsAsReadRequest(tenant: tenant),
      ),
    );
  }

  /// Makes the call [send] makes through `api`, as the reader [accessToken]
  /// signs in, or anonymously when it is empty.
  Future<T> _call<T>(
    String accessToken,
    Future<T> Function(
      pb.AuthServiceApi api,
      ConnectCallContext call,
      pb.TenantContext tenant,
    )
    send,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      return await send(
        pb.AuthServiceApi(_client),
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.TenantContext(tenantId: tenantId),
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

  /// A row with no id is dropped: it could be neither opened nor marked read.
  /// An answer that carries no announcement at all reads as one without an
  /// id.
  Announcement? _announcementOf(pb.AnnouncementItem item) {
    final id = item.id.trim();
    if (id.isEmpty) {
      return null;
    }
    return Announcement(
      id: id,
      title: item.title.trim(),
      body: item.body.trim(),
      linkUrl: item.linkUrl.trim(),
      isRead: item.isRead,
      createdAt: _readInstant(item.createdAt),
      pinnedUntil: _readInstant(item.pinnedUntil),
      locale: item.locale.trim(),
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

  DateTime? _readInstant(String value) =>
      DateTime.tryParse(value.trim())?.toLocal();
}
