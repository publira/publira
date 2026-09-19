import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_repository.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/config.dart';

/// [AuthRepository] backed by `publira.v1.AuthService` on the public API.
class HttpAuthRepository implements AuthRepository {
  factory HttpAuthRepository({
    required AppConfig config,
    ConnectClient? client,
    TenantResolver? tenants,
  }) {
    final resolved = client ?? ConnectClient(baseUrl: config.apiBaseUrl);
    return HttpAuthRepository._(
      client: resolved,
      tenants:
          tenants ??
          TenantResolver(client: resolved, tenantHost: config.tenantHost),
    );
  }

  HttpAuthRepository._({required this._client, required this._tenants});

  static const _loginProcedure = '/publira.v1.AuthService/Login';
  static const _getMeProcedure = '/publira.v1.AuthService/GetMe';
  static const _updateMeProcedure = '/publira.v1.AuthService/UpdateMe';
  static const _tenantProcedure = '/publira.v1.TenantService/GetTenant';

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<AuthSession> signIn({
    required String email,
    required String password,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_loginProcedure, {
        'tenant': {'tenantId': tenantId},
        'email': email,
        'password': password,
      }, tenantId: tenantId);
      return _sessionFromLogin(body);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<AuthSession> refresh(AuthSession session) async {
    final user = await _getMe(session);
    return session.withUser(
      userPublicId: _readString(user, 'publicId'),
      userName: _readString(user, 'name'),
    );
  }

  @override
  Future<ReaderAge> readReaderAge(AuthSession session) async {
    final tenantRead = _getTenant();
    final Map<String, Object?> user;
    try {
      user = await _getMe(session);
    } catch (_) {
      tenantRead.ignore();
      rethrow;
    }
    final tenant = await tenantRead;
    return ReaderAge(
      birthDate: _readString(user, 'birthDate'),
      timeZone: _readString(tenant, 'timezone'),
      verification: AgeVerification.fromWire(tenant['ageVerification']),
    );
  }

  @override
  Future<String> readEmail(AuthSession session) async {
    final user = await _getMe(session);
    return _readString(user, 'email');
  }

  @override
  Future<String> recordBirthDate(
    AuthSession session,
    DateTime birthDate,
  ) async {
    // UpdateMe also renames the account, so the name it holds now is sent back
    // unchanged rather than the one this session remembered.
    final current = await _getMe(session);
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _updateMeProcedure,
        {
          'tenant': {'tenantId': tenantId},
          'name': _readString(current, 'name'),
          'birthDate': formatBirthDate(birthDate),
        },
        tenantId: tenantId,
        accessToken: session.accessToken,
      );
      return _readString(_expectMap(body['user'], 'user'), 'birthDate');
    } on ConnectException catch (error) {
      throw switch (error.code) {
        'unauthenticated' => AuthFailure(
          AuthFailureKind.sessionExpired,
          message: error.message,
        ),
        'invalid_argument' => AuthFailure(
          AuthFailureKind.birthDateInvalid,
          message: error.message,
        ),
        'failed_precondition' => AuthFailure(
          AuthFailureKind.birthDateAlreadySet,
          message: error.message,
        ),
        _ => _toFailure(error),
      };
    }
  }

  Future<Map<String, Object?>> _getTenant() async {
    try {
      final tenantId = await _tenants.resolve();
      return await _client.unary(_tenantProcedure, {
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// The `User` behind [session], as `GetMe` answers with it.
  ///
  /// The token under test travels explicitly, so a check does not depend on
  /// the app having already adopted the session it is checking.
  Future<Map<String, Object?>> _getMe(AuthSession session) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _getMeProcedure,
        {
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: session.accessToken,
      );
      return _expectMap(body['user'], 'user');
    } on ConnectException catch (error) {
      if (error.code == 'unauthenticated') {
        throw AuthFailure(
          AuthFailureKind.sessionExpired,
          message: error.message,
        );
      }
      throw _toFailure(error);
    }
  }

  AuthSession _sessionFromLogin(Map<String, Object?> body) {
    final accessToken = _expectMap(body['accessToken'], 'accessToken');
    final user = _expectMap(body['user'], 'user');
    final token = _readString(accessToken, 'token');
    if (token.isEmpty) {
      throw const AuthFailure(
        AuthFailureKind.unexpected,
        message: 'Login returned an empty access token',
      );
    }
    return AuthSession(
      accessToken: token,
      userPublicId: _readString(user, 'publicId'),
      userName: _readString(user, 'name'),
      expiresAt: DateTime.tryParse(
        _readString(accessToken, 'expiresAt'),
      )?.toUtc(),
    );
  }

  AuthFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return AuthFailure(AuthFailureKind.network, message: error.message);
    }
    return switch (error.code) {
      'unauthenticated' => AuthFailure(
        AuthFailureKind.invalidCredentials,
        message: error.message,
      ),
      'failed_precondition' => AuthFailure(
        AuthFailureKind.emailNotVerified,
        message: error.message,
      ),
      _ => AuthFailure(AuthFailureKind.unexpected, message: error.message),
    };
  }

  Map<String, Object?> _expectMap(Object? value, String path) {
    if (value is Map) {
      return value.map((key, item) => MapEntry(key.toString(), item));
    }
    throw AuthFailure(
      AuthFailureKind.unexpected,
      message: '$path must be an object',
    );
  }

  String _readString(Map<String, Object?> json, String key) {
    final value = json[key];
    return value is String ? value.trim() : '';
  }
}
