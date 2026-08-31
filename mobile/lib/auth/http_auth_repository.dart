import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_repository.dart';
import 'package:publira/auth/auth_session.dart';
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

  HttpAuthRepository._({
    required ConnectClient client,
    required TenantResolver tenants,
  }) : _client = client,
       _tenants = tenants;

  static const _loginProcedure = '/publira.v1.AuthService/Login';
  static const _getMeProcedure = '/publira.v1.AuthService/GetMe';

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
    try {
      final tenantId = await _tenants.resolve();
      // The token under test travels explicitly, so the check does not depend
      // on the app having already adopted it.
      final body = await _client.unary(
        _getMeProcedure,
        {
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: session.accessToken,
      );
      final user = _expectMap(body['user'], 'user');
      return session.withUser(
        userPublicId: _readString(user, 'publicId'),
        userName: _readString(user, 'name'),
      );
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
