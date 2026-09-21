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
  static const _createUserProcedure = '/publira.v1.AuthService/CreateUser';
  static const _verifyUserEmailProcedure =
      '/publira.v1.AuthService/VerifyUserEmail';
  static const _requestEmailVerificationProcedure =
      '/publira.v1.AuthService/RequestEmailVerification';
  static const _requestPasswordResetProcedure =
      '/publira.v1.AuthService/RequestPasswordReset';
  static const _confirmPasswordResetProcedure =
      '/publira.v1.AuthService/ConfirmPasswordReset';
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
  Future<void> signUp({
    required String name,
    required String email,
    required String password,
    String birthDate = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_createUserProcedure, {
        'tenant': {'tenantId': tenantId},
        'name': name,
        'email': email,
        'password': password,
        // protojson reads an absent field as the empty string, which is what
        // the API takes as a form that did not ask for a date.
        if (birthDate.isNotEmpty) 'birthDate': birthDate,
      }, tenantId: tenantId);
      if (body['accepted'] != true) {
        throw const AuthFailure(
          AuthFailureKind.unexpected,
          message: 'CreateUser answered without accepting the signup',
        );
      }
    } on ConnectException catch (error) {
      throw _toMailFailure(error);
    }
  }

  @override
  Future<void> verifyEmail(String token) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_verifyUserEmailProcedure, {
        'tenant': {'tenantId': tenantId},
        'token': token,
      }, tenantId: tenantId);
      if (body['verified'] != true) {
        throw const AuthFailure(
          AuthFailureKind.unexpected,
          message: 'VerifyUserEmail answered without confirming the address',
        );
      }
    } on ConnectException catch (error) {
      throw _toLinkFailure(error);
    }
  }

  @override
  Future<void> requestEmailVerification(String email) async {
    try {
      final tenantId = await _tenants.resolve();
      await _client.unary(_requestEmailVerificationProcedure, {
        'tenant': {'tenantId': tenantId},
        'email': email,
      }, tenantId: tenantId);
    } on ConnectException catch (error) {
      throw _toMailFailure(error);
    }
  }

  @override
  Future<void> requestPasswordReset(String email) async {
    try {
      final tenantId = await _tenants.resolve();
      await _client.unary(_requestPasswordResetProcedure, {
        'tenant': {'tenantId': tenantId},
        'email': email,
      }, tenantId: tenantId);
    } on ConnectException catch (error) {
      throw _toMailFailure(error);
    }
  }

  @override
  Future<void> confirmPasswordReset({
    required String token,
    required String newPassword,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_confirmPasswordResetProcedure, {
        'tenant': {'tenantId': tenantId},
        'token': token,
        'newPassword': newPassword,
      }, tenantId: tenantId);
      if (body['confirmed'] != true) {
        throw const AuthFailure(
          AuthFailureKind.unexpected,
          message: 'ConfirmPasswordReset answered without setting the password',
        );
      }
    } on ConnectException catch (error) {
      // The screen never sends an empty token, so what the API calls missing
      // here is a password that trimmed down to nothing.
      if (error.code == 'invalid_argument') {
        throw AuthFailure(AuthFailureKind.invalidInput, message: error.message);
      }
      throw _toLinkFailure(error);
    }
  }

  @override
  Future<AgeVerification> readAgeVerification() async {
    final tenant = await _getTenant();
    return AgeVerification.fromWire(tenant['ageVerification']);
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

  /// What the RPCs that answer by sending mail refuse with. Login's own
  /// codes do not apply to them: an address nobody has signed up with is
  /// accepted here rather than rejected.
  AuthFailure _toMailFailure(ConnectException error) {
    if (error.isUnavailable) {
      return AuthFailure(AuthFailureKind.network, message: error.message);
    }
    return switch (error.code) {
      'invalid_argument' => AuthFailure(
        AuthFailureKind.invalidInput,
        message: error.message,
      ),
      'resource_exhausted' => AuthFailure(
        AuthFailureKind.rateLimited,
        message: error.message,
      ),
      _ => AuthFailure(AuthFailureKind.unexpected, message: error.message),
    };
  }

  /// What the RPCs that spend an emailed link's token refuse with.
  AuthFailure _toLinkFailure(ConnectException error) {
    return switch (error.code) {
      // A token the API never issued, and one it has already forgotten, are
      // the same not_found and the same dead end for the reader.
      'not_found' || 'invalid_argument' => AuthFailure(
        AuthFailureKind.linkInvalid,
        message: error.message,
      ),
      'failed_precondition' => AuthFailure(
        AuthFailureKind.linkExpired,
        message: error.message,
      ),
      _ => _toFailure(error),
    };
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
