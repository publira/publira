import 'dart:async';

import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/auth.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/tenant.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/api/unknown_enum.dart';
import 'package:publira/api/user_icon.dart';
import 'package:publira/auth/account_icon.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_repository.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/email_change.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/notification_settings.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/auth/reader_icon_policy.dart';
import 'package:publira/auth/sign_up_requirements.dart';
import 'package:publira/config.dart';

/// [AuthRepository] backed by `publira.v1.AuthService` on the public API.
class HttpAuthRepository implements AuthRepository {
  factory HttpAuthRepository({
    required AppConfig config,
    ConnectClient? client,
    TenantResolver? tenants,
  }) {
    final resolved = client ?? ConnectClient(baseUrl: config.baseUrl);
    return HttpAuthRepository._(
      config: config,
      client: resolved,
      tenants:
          tenants ??
          TenantResolver(client: resolved, tenantHost: config.tenantHost),
    );
  }

  HttpAuthRepository._({
    required this._config,
    required this._client,
    required this._tenants,
  });

  /// `GetTenantResponse.age_verification`'s field number.
  static const _ageVerificationField = 12;

  /// `GetTenantReaderIconPolicyResponse.policy`'s field number.
  static const _readerIconPolicyField = 1;

  final AppConfig _config;
  final ConnectClient _client;
  final TenantResolver _tenants;

  pb.AuthServiceApi get _auth => pb.AuthServiceApi(_client);

  @override
  Future<AuthSession> signIn({
    required String email,
    required String password,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.login(
        ConnectCallContext(tenantId: tenantId),
        pb.LoginRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          email: email,
          password: password,
        ),
      );
      return _sessionFromLogin(
        _required(body.hasUser(), body.user, 'user'),
        _required(body.hasAccessToken(), body.accessToken, 'accessToken'),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<SignInProviders> readSignInProviders() async {
    final association = _readTenant(
      (service, ctx, tenant) => service.getTenantMobileAppAssociation(
        ctx,
        pb.GetTenantMobileAppAssociationRequest(tenant: tenant),
      ),
    );
    // Listened to from the start, so its failure is not reported as uncaught
    // while GetTenant is still in flight.
    unawaited(association.then<void>((_) {}, onError: (_) {}));
    final tenant = await _getTenant();
    var appleBundleIdentifier = '';
    var androidApplicationId = '';
    try {
      final apps = await association;
      appleBundleIdentifier = apps.ios.bundleIdentifier.trim();
      androidApplicationId = apps.android.applicationId.trim();
    } on AuthFailure {
      // Without it no app is known to take Apple's token; Google still is.
    }
    return SignInProviders(
      // The wire format sends an enabled provider with no field set as an
      // empty message.
      apple: tenant.hasAppleSignIn(),
      appleBundleIdentifier: appleBundleIdentifier,
      appleServicesId: tenant.appleSignIn.servicesId.trim(),
      androidApplicationId: androidApplicationId,
      google: tenant.hasGoogleSignIn()
          ? GoogleSignInClients(
              webClientId: tenant.googleSignIn.webClientId.trim(),
              iosClientId: tenant.googleSignIn.iosClientId.trim(),
            )
          : null,
    );
  }

  @override
  Future<AuthSession> signInWithProvider(
    ProviderCredential credential, {
    String birthDate = '',
    List<String> agreedPageVersionIds = const [],
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.loginWithIdToken(
        ConnectCallContext(tenantId: tenantId),
        pb.LoginWithIdTokenRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          provider: credential.provider.wire,
          idToken: credential.idToken,
          nonce: credential.nonce,
          authorizationCode: credential.authorizationCode.isEmpty
              ? null
              : credential.authorizationCode,
          redirectUri: credential.redirectUri.isEmpty
              ? null
              : credential.redirectUri,
          name: credential.name.isEmpty ? null : credential.name,
          birthDate: birthDate.isEmpty ? null : birthDate,
          agreedPageVersionIds: agreedPageVersionIds,
        ),
      );
      return _sessionFromLogin(
        _required(body.hasUser(), body.user, 'user'),
        _required(body.hasAccessToken(), body.accessToken, 'accessToken'),
      );
    } on ConnectException catch (error) {
      throw _toProviderSignInFailure(error);
    }
  }

  @override
  Future<LinkedIdentities> readLinkedIdentities(AuthSession session) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.listMyIdentities(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.ListMyIdentitiesRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
      return LinkedIdentities(
        identities: [
          for (final item in body.identities)
            if (IdentityProvider.fromWire(item.provider) case final provider?)
              LinkedIdentity(
                provider: provider,
                email: item.email.trim(),
                linkedAt: DateTime.tryParse(item.linkedAt.trim())?.toUtc(),
              ),
        ],
        hasPassword: body.hasPassword,
        hasPasskey: body.hasPasskey,
      );
    } on ConnectException catch (error) {
      throw _toAccountFailure(error);
    }
  }

  @override
  Future<void> unlinkIdentity(
    AuthSession session,
    IdentityProvider provider,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      await _auth.unlinkIdentity(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.UnlinkIdentityRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          provider: provider.wire,
        ),
      );
    } on ConnectException catch (error) {
      switch (error.code) {
        // Unlinked already, from another device or the site.
        case 'not_found':
          return;
        case 'failed_precondition':
          throw AuthFailure(
            AuthFailureKind.lastSignInMethod,
            message: error.message,
          );
      }
      throw _toAccountFailure(error);
    }
  }

  @override
  Future<void> linkIdentity(
    AuthSession session,
    ProviderCredential credential,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      await _auth.linkIdentity(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.LinkIdentityRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          provider: credential.provider.wire,
          idToken: credential.idToken,
          nonce: credential.nonce,
          authorizationCode: credential.authorizationCode.isEmpty
              ? null
              : credential.authorizationCode,
          redirectUri: credential.redirectUri.isEmpty
              ? null
              : credential.redirectUri,
        ),
      );
    } on ConnectException catch (error) {
      final reasons = error.reasons;
      throw switch (error.code) {
        'failed_precondition'
            when reasons.contains(identityLinkedToAnotherAccountReason) =>
          AuthFailure(
            AuthFailureKind.linkedToAnotherAccount,
            message: error.message,
          ),
        'failed_precondition'
            when reasons.contains(providerAlreadyLinkedReason) =>
          AuthFailure(
            AuthFailureKind.providerAlreadyLinked,
            message: error.message,
          ),
        // The tenant stopped offering the provider after the screen read it.
        'failed_precondition' when reasons.isEmpty => AuthFailure(
          AuthFailureKind.providerRefused,
          message: error.message,
        ),
        // A token or a nonce the API would not take is `invalid_argument`,
        // which reads as invalidInput rather than as an ended session.
        _ => _toAccountFailure(error),
      };
    }
  }

  @override
  Future<String> beginPasskeySignIn() async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.beginPasskeyLogin(
        ConnectCallContext(tenantId: tenantId),
        pb.BeginPasskeyLoginRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
      return _requiredText(body.requestOptionsJson, 'requestOptionsJson');
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<AuthSession> signInWithPasskey(String credentialJson) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.finishPasskeyLogin(
        ConnectCallContext(tenantId: tenantId),
        pb.FinishPasskeyLoginRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          credentialJson: credentialJson,
        ),
      );
      return _sessionFromLogin(
        _required(body.hasUser(), body.user, 'user'),
        _required(body.hasAccessToken(), body.accessToken, 'accessToken'),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<List<Passkey>> readPasskeys(AuthSession session) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.listMyPasskeys(
        _sessionContext(tenantId, session),
        pb.ListMyPasskeysRequest(tenant: pb.TenantContext(tenantId: tenantId)),
      );
      return [for (final passkey in body.passkeys) _passkey(passkey)];
    } on ConnectException catch (error) {
      throw _toAccountFailure(error);
    }
  }

  @override
  Future<String> beginPasskeyRegistration(AuthSession session) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.beginPasskeyRegistration(
        _sessionContext(tenantId, session),
        pb.BeginPasskeyRegistrationRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
      return _requiredText(body.creationOptionsJson, 'creationOptionsJson');
    } on ConnectException catch (error) {
      throw _toPasskeyFailure(error);
    }
  }

  @override
  Future<Passkey> finishPasskeyRegistration(
    AuthSession session,
    String credentialJson,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.finishPasskeyRegistration(
        _sessionContext(tenantId, session),
        pb.FinishPasskeyRegistrationRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          credentialJson: credentialJson,
        ),
      );
      return _passkey(_required(body.hasPasskey(), body.passkey, 'passkey'));
    } on ConnectException catch (error) {
      throw _toPasskeyFailure(error);
    }
  }

  @override
  Future<Passkey> renamePasskey(
    AuthSession session,
    String id,
    String name,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.renamePasskey(
        _sessionContext(tenantId, session),
        pb.RenamePasskeyRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          id: id,
          name: name,
        ),
      );
      return _passkey(_required(body.hasPasskey(), body.passkey, 'passkey'));
    } on ConnectException catch (error) {
      throw _toPasskeyFailure(error);
    }
  }

  @override
  Future<void> deletePasskey(AuthSession session, String id) async {
    try {
      final tenantId = await _tenants.resolve();
      await _auth.deletePasskey(
        _sessionContext(tenantId, session),
        pb.DeletePasskeyRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          id: id,
        ),
      );
    } on ConnectException catch (error) {
      switch (error.code) {
        // Removed already, from another device or the site.
        case 'not_found':
          return;
        case 'failed_precondition':
          throw AuthFailure(
            AuthFailureKind.lastSignInMethod,
            message: error.message,
          );
      }
      throw _toAccountFailure(error);
    }
  }

  @override
  Future<String> beginPasskeyConfirmation(AuthSession session) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.beginPasskeyConfirmation(
        _sessionContext(tenantId, session),
        pb.BeginPasskeyConfirmationRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
      return _requiredText(body.requestOptionsJson, 'requestOptionsJson');
    } on ConnectException catch (error) {
      // The account holds no passkey to allow.
      if (error.code == 'failed_precondition') {
        throw AuthFailure(
          AuthFailureKind.passkeyNotFound,
          message: error.message,
        );
      }
      throw _toAccountFailure(error);
    }
  }

  ConnectCallContext _sessionContext(String tenantId, AuthSession session) =>
      ConnectCallContext(tenantId: tenantId, accessToken: session.accessToken);

  static Passkey _passkey(pb.Passkey passkey) => Passkey(
    id: passkey.id.trim(),
    name: passkey.name.trim(),
    createdAt: DateTime.tryParse(passkey.createdAt.trim())?.toUtc(),
    lastUsedAt: DateTime.tryParse(passkey.lastUsedAt.trim())?.toUtc(),
    backedUp: passkey.backedUp,
  );

  @override
  Future<void> signUp({
    required String name,
    required String email,
    required String password,
    String birthDate = '',
    List<String> agreedPageVersionIds = const [],
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.createUser(
        ConnectCallContext(tenantId: tenantId),
        pb.CreateUserRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          name: name,
          email: email,
          password: password,
          // An absent field reads as the empty string, which is what
          // the API takes as a form that did not ask for a date.
          birthDate: birthDate.isEmpty ? null : birthDate,
          agreedPageVersionIds: agreedPageVersionIds,
        ),
      );
      if (!body.accepted) {
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
      final body = await _auth.verifyUserEmail(
        ConnectCallContext(tenantId: tenantId),
        pb.VerifyUserEmailRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          token: token,
        ),
      );
      if (!body.verified) {
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
      await _auth.requestEmailVerification(
        ConnectCallContext(tenantId: tenantId),
        pb.RequestEmailVerificationRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          email: email,
        ),
      );
    } on ConnectException catch (error) {
      throw _toMailFailure(error);
    }
  }

  @override
  Future<void> requestPasswordReset(String email) async {
    try {
      final tenantId = await _tenants.resolve();
      await _auth.requestPasswordReset(
        ConnectCallContext(tenantId: tenantId),
        pb.RequestPasswordResetRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          email: email,
        ),
      );
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
      final body = await _auth.confirmPasswordReset(
        ConnectCallContext(tenantId: tenantId),
        pb.ConfirmPasswordResetRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          token: token,
          newPassword: newPassword,
        ),
      );
      if (!body.confirmed) {
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
  Future<SignUpRequirements> readSignUpRequirements({
    required String locale,
  }) async {
    final [
      tenant as pb.GetTenantResponse,
      legalPages as pb.GetTenantLegalPagesResponse,
    ] = await Future.wait<Object>([
      _getTenant(),
      _readTenant(
        (service, ctx, tenant) => service.getTenantLegalPages(
          ctx,
          pb.GetTenantLegalPagesRequest(tenant: tenant, locale: locale),
        ),
      ),
    ]);
    return SignUpRequirements(
      ageVerification: _ageVerification(tenant),
      termsPage: _legalPage(legalPages.termsPage),
      privacyPage: _legalPage(legalPages.privacyPage),
    );
  }

  @override
  Future<List<LegalPage>> readOwedLegalPages(
    AuthSession session, {
    required String locale,
  }) => _legalPageAgreements(session, (ctx, tenant) async {
    final body = await _auth.getMyLegalPageAgreements(
      ctx,
      pb.GetMyLegalPageAgreementsRequest(tenant: tenant, locale: locale),
    );
    return (body.termsPage, body.privacyPage);
  });

  @override
  Future<List<LegalPage>> agreeToLegalPages(
    AuthSession session, {
    required List<String> agreedPageVersionIds,
    required String locale,
  }) => _legalPageAgreements(session, (ctx, tenant) async {
    final body = await _auth.agreeToLegalPages(
      ctx,
      pb.AgreeToLegalPagesRequest(
        tenant: tenant,
        agreedPageVersionIds: agreedPageVersionIds,
        locale: locale,
      ),
    );
    return (body.termsPage, body.privacyPage);
  });

  /// Sends [send] for the reader behind [session], both of whose answers
  /// name the pages the reader owes afterwards, terms first.
  Future<List<LegalPage>> _legalPageAgreements(
    AuthSession session,
    Future<(pb.TenantLegalPage, pb.TenantLegalPage)> Function(
      ConnectCallContext ctx,
      pb.TenantContext tenant,
    )
    send,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      final (termsPage, privacyPage) = await send(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.TenantContext(tenantId: tenantId),
      );
      return legalPagesToAgreeTo(
        termsPage: _legalPage(termsPage),
        privacyPage: _legalPage(privacyPage),
      );
    } on ConnectException catch (error) {
      throw _toAccountFailure(error);
    }
  }

  /// [page] as one to agree to. The wire format omits a role the tenant names
  /// nothing for, which reads as a page with every part empty.
  static LegalPage? _legalPage(pb.TenantLegalPage page) => LegalPage.fromParts(
    slug: page.slug,
    title: page.title,
    versionId: page.versionId,
  );

  @override
  Future<AuthSession> refresh(AuthSession session) async {
    final user = await _getMe(session);
    return _withUserOf(session, user);
  }

  @override
  Future<ReaderAge> readReaderAge(AuthSession session) async {
    final tenantRead = _getTenant();
    // Listened to from the start, so a tenant failure that lands before GetMe
    // answers is not reported as uncaught; the await below still throws it.
    unawaited(tenantRead.then<void>((_) {}, onError: (_) {}));
    final user = await _getMe(session);
    final tenant = await tenantRead;
    return ReaderAge(
      birthDate: user.birthDate.trim(),
      timeZone: tenant.timezone.trim(),
      verification: _ageVerification(tenant),
    );
  }

  @override
  Future<String> readEmail(AuthSession session) async {
    final user = await _getMe(session);
    return user.email.trim();
  }

  @override
  Future<NotificationSettings> readNotificationSettings(AuthSession session) =>
      _notificationSettings(session, (ctx, tenant) async {
        final body = await _auth.getNotificationSettings(
          ctx,
          pb.GetNotificationSettingsRequest(tenant: tenant),
        );
        return _toNotificationSettings(
          body.hasPreferences() ? body.preferences : null,
        );
      });

  @override
  Future<NotificationSettings> updateNotificationSettings(
    AuthSession session, {
    required NotificationSettings current,
    Map<NotificationCell, bool> cells = const {},
  }) => _notificationSettings(session, (ctx, tenant) async {
    final request = pb.UpdateNotificationSettingsRequest(tenant: tenant);
    final emailCells = cellsOfChannel(NotificationChannel.email);
    final written = {
      if (!cells.keys.any(emailCells.contains))
        for (final cell in emailCells) cell: current.isEnabled(cell),
      ...cells,
    };
    for (final MapEntry(key: cell, value: enabled) in written.entries) {
      _setRequestCell(request, cell, enabled);
    }
    final body = await _auth.updateNotificationSettings(ctx, request);
    return _toNotificationSettings(
      body.hasPreferences() ? body.preferences : null,
    );
  });

  /// Sends [send] for the account behind [session], both of whose answers
  /// carry the settings the account holds afterwards.
  Future<NotificationSettings> _notificationSettings(
    AuthSession session,
    Future<NotificationSettings> Function(
      ConnectCallContext ctx,
      pb.TenantContext tenant,
    )
    send,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      return await send(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.TenantContext(tenantId: tenantId),
      );
    } on ConnectException catch (error) {
      throw _toAccountFailure(error);
    }
  }

  /// The settings an answer carries. The wire format omits a false, so an
  /// absent field is a setting that is off; an absent [preferences] message
  /// is a server that predates them, whose notifications all still arrive.
  static NotificationSettings _toNotificationSettings(
    pb.NotificationPreferences? preferences,
  ) => NotificationSettings(
    preferences: preferences == null
        ? const {}
        : {
            for (final cell in notificationCells)
              cell: _preferenceCell(preferences, cell),
          },
  );

  static bool _preferenceCell(
    pb.NotificationPreferences preferences,
    NotificationCell cell,
  ) => switch (cell) {
    (NotificationCategory.followedEpisodes, NotificationChannel.inbox) =>
      preferences.followedEpisodesInboxEnabled,
    (NotificationCategory.followedEpisodes, NotificationChannel.webPush) =>
      preferences.followedEpisodesWebPushEnabled,
    (NotificationCategory.followedEpisodes, NotificationChannel.mobilePush) =>
      preferences.followedEpisodesMobilePushEnabled,
    (NotificationCategory.followedEpisodes, NotificationChannel.email) =>
      preferences.followedEpisodesEmailEnabled,
    (NotificationCategory.followedCreators, NotificationChannel.inbox) =>
      preferences.followedCreatorsInboxEnabled,
    (NotificationCategory.followedCreators, NotificationChannel.webPush) =>
      preferences.followedCreatorsWebPushEnabled,
    (NotificationCategory.followedCreators, NotificationChannel.mobilePush) =>
      preferences.followedCreatorsMobilePushEnabled,
    (NotificationCategory.followedCreators, NotificationChannel.email) =>
      preferences.followedCreatorsEmailEnabled,
    (NotificationCategory.comments, NotificationChannel.inbox) =>
      preferences.commentsInboxEnabled,
    (NotificationCategory.comments, NotificationChannel.email) =>
      preferences.commentsEmailEnabled,
    (NotificationCategory.announcements, NotificationChannel.inbox) =>
      preferences.announcementsInboxEnabled,
    (NotificationCategory.announcements, NotificationChannel.email) =>
      preferences.announcementsEmailEnabled,
    // No cell the server delivers; [notificationCells] names none of these.
    (NotificationCategory.comments, _) ||
    (NotificationCategory.announcements, _) => true,
  };

  static void _setRequestCell(
    pb.UpdateNotificationSettingsRequest request,
    NotificationCell cell,
    bool enabled,
  ) {
    switch (cell) {
      case (NotificationCategory.followedEpisodes, NotificationChannel.inbox):
        request.followedEpisodesInboxEnabled = enabled;
      case (NotificationCategory.followedEpisodes, NotificationChannel.webPush):
        request.followedEpisodesWebPushEnabled = enabled;
      case (
        NotificationCategory.followedEpisodes,
        NotificationChannel.mobilePush,
      ):
        request.followedEpisodesMobilePushEnabled = enabled;
      case (NotificationCategory.followedEpisodes, NotificationChannel.email):
        request.followedEpisodesEmailEnabled = enabled;
      case (NotificationCategory.followedCreators, NotificationChannel.inbox):
        request.followedCreatorsInboxEnabled = enabled;
      case (NotificationCategory.followedCreators, NotificationChannel.webPush):
        request.followedCreatorsWebPushEnabled = enabled;
      case (
        NotificationCategory.followedCreators,
        NotificationChannel.mobilePush,
      ):
        request.followedCreatorsMobilePushEnabled = enabled;
      case (NotificationCategory.followedCreators, NotificationChannel.email):
        request.followedCreatorsEmailEnabled = enabled;
      case (NotificationCategory.comments, NotificationChannel.inbox):
        request.commentsInboxEnabled = enabled;
      case (NotificationCategory.comments, NotificationChannel.email):
        request.commentsEmailEnabled = enabled;
      case (NotificationCategory.announcements, NotificationChannel.inbox):
        request.announcementsInboxEnabled = enabled;
      case (NotificationCategory.announcements, NotificationChannel.email):
        request.announcementsEmailEnabled = enabled;
      // The request has no field for a cell the server does not deliver.
      case (NotificationCategory.comments, _) ||
          (NotificationCategory.announcements, _):
        break;
    }
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
      final body = await _auth.updateMe(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.UpdateMeRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          name: current.name.trim(),
          birthDate: formatBirthDate(birthDate),
        ),
      );
      return _required(body.hasUser(), body.user, 'user').birthDate.trim();
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

  @override
  Future<AuthSession> updateName(AuthSession session, String name) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.updateMe(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.UpdateMeRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          name: name,
        ),
      );
      final user = _required(body.hasUser(), body.user, 'user');
      return _withUserOf(session, user);
    } on ConnectException catch (error) {
      throw _toAccountFailure(error);
    }
  }

  /// How long an icon upload is given, past the client's own timeout: the
  /// request carries up to 10 MiB of image, a third more again in base64,
  /// over whatever network the reader is on.
  static const _uploadIconTimeout = Duration(minutes: 1);

  @override
  Future<AuthSession> uploadIcon(
    AuthSession session,
    AccountIconUpload upload,
  ) => _changeIcon(session, (ctx, tenant) async {
    final body = await _auth.uploadMyIcon(
      ctx,
      pb.UploadMyIconRequest(
        tenant: tenant,
        iconData: upload.bytes,
        iconContentType: upload.contentType,
      ),
    );
    return _required<pb.User>(body.hasUser(), body.user, 'user');
  }, timeout: _uploadIconTimeout);

  @override
  Future<AuthSession> removeIcon(AuthSession session) =>
      _changeIcon(session, (ctx, tenant) async {
        final body = await _auth.deleteMyIcon(
          ctx,
          pb.DeleteMyIconRequest(tenant: tenant),
        );
        return _required<pb.User>(body.hasUser(), body.user, 'user');
      });

  @override
  Future<AuthSession> selectIcon(AuthSession session, String presetId) =>
      _changeIcon(session, (ctx, tenant) async {
        final pb.SelectMyIconResponse body;
        try {
          body = await _auth.selectMyIcon(
            ctx,
            pb.SelectMyIconRequest(tenant: tenant, presetId: presetId),
          );
        } on ConnectException catch (error) {
          if (error.code == 'not_found') {
            throw AuthFailure(
              AuthFailureKind.iconPresetUnavailable,
              message: error.message,
            );
          }
          rethrow;
        }
        return _required<pb.User>(body.hasUser(), body.user, 'user');
      });

  @override
  Future<ReaderIconChoice> readIconChoice() async {
    final body = await _readTenant(
      (service, ctx, tenant) => service.getTenantReaderIconPolicy(
        ctx,
        pb.GetTenantReaderIconPolicyRequest(tenant: tenant),
      ),
    );
    // A policy this build does not know offers nothing, the one choice whose
    // every control the API is sure to accept.
    if (carriesUnknownEnum(body, _readerIconPolicyField)) {
      return const ReaderIconDisabled();
    }
    return switch (body.policy) {
      pb.ReaderIconPolicy.READER_ICON_POLICY_UPLOAD => const ReaderIconUpload(),
      pb.ReaderIconPolicy.READER_ICON_POLICY_PRESET => ReaderIconPresets([
        for (final preset in body.presets) ?_presetOf(preset),
      ]),
      _ => const ReaderIconDisabled(),
    };
  }

  /// [preset] as the account screen offers it, or `null` for one with no id
  /// to send or no image to draw.
  ReaderIconPreset? _presetOf(pb.ReaderIconPreset preset) {
    final id = preset.id.trim();
    final iconUrl = userIconUrl(preset.variants, _config);
    if (id.isEmpty || iconUrl == null) {
      return null;
    }
    return ReaderIconPreset(id: id, iconUrl: iconUrl);
  }

  /// Sends [send] for the reader behind [session], every one of whose answers
  /// is the account with the icon it then shows.
  Future<AuthSession> _changeIcon(
    AuthSession session,
    Future<pb.User> Function(ConnectCallContext ctx, pb.TenantContext tenant)
    send, {
    Duration? timeout,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final user = await send(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
          timeout: timeout,
        ),
        pb.TenantContext(tenantId: tenantId),
      );
      return _withUserOf(session, user);
    } on ConnectException catch (error) {
      final fields = error.fieldViolations;
      if (error.code == 'invalid_argument' &&
          (fields.contains('icon_data') || fields.contains('icon_crop'))) {
        throw AuthFailure(AuthFailureKind.iconRefused, message: error.message);
      }
      if (error.code == 'failed_precondition' &&
          error.reasons.contains(storageNotConfiguredReason)) {
        throw AuthFailure(
          AuthFailureKind.storageNotConfigured,
          message: error.message,
        );
      }
      if (error.code == 'failed_precondition' &&
          error.reasons.contains(readerIconNotAllowedReason)) {
        throw AuthFailure(
          AuthFailureKind.iconNotAllowed,
          message: error.message,
        );
      }
      throw _toAccountFailure(error);
    }
  }

  @override
  Future<AuthSession> changePassword(
    AuthSession session, {
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.changePassword(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.ChangePasswordRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          currentPassword: currentPassword,
          newPassword: newPassword,
        ),
      );
      final accessToken = _required(
        body.hasAccessToken(),
        body.accessToken,
        'accessToken',
      );
      final token = accessToken.token.trim();
      if (token.isEmpty) {
        // The change has been made and the token this device held is over, so
        // there is no session left to keep.
        throw const AuthFailure(
          AuthFailureKind.sessionExpired,
          message: 'ChangePassword returned an empty access token',
        );
      }
      return session.withAccessToken(
        token,
        expiresAt: DateTime.tryParse(accessToken.expiresAt.trim())?.toUtc(),
      );
    } on ConnectException catch (error) {
      throw _toAccountFailure(error);
    }
  }

  @override
  Future<void> requestEmailChange(
    AuthSession session, {
    required String currentEmail,
    required String newEmail,
    required String currentPassword,
  }) async {
    try {
      await _requestEmailChange(
        session,
        (tenant) => pb.RequestEmailChangeRequest(
          tenant: tenant,
          currentEmail: currentEmail,
          newEmail: newEmail,
          currentPassword: currentPassword,
        ),
      );
    } on ConnectException catch (error) {
      throw _toAccountFailure(error);
    }
  }

  @override
  Future<void> requestEmailChangeWithProvider(
    AuthSession session, {
    required String currentEmail,
    required String newEmail,
    required ProviderCredential credential,
  }) async {
    try {
      await _requestEmailChange(
        session,
        (tenant) => pb.RequestEmailChangeRequest(
          tenant: tenant,
          currentEmail: currentEmail,
          newEmail: newEmail,
          provider: credential.provider.wire,
          idToken: credential.idToken,
          nonce: credential.nonce,
        ),
      );
    } on ConnectException catch (error) {
      throw await _toConfirmationFailure(session, error);
    }
  }

  @override
  Future<void> requestEmailChangeWithPasskey(
    AuthSession session, {
    required String currentEmail,
    required String newEmail,
    required String credentialJson,
  }) async {
    try {
      await _requestEmailChange(
        session,
        (tenant) => pb.RequestEmailChangeRequest(
          tenant: tenant,
          currentEmail: currentEmail,
          newEmail: newEmail,
          passkeyCredentialJson: credentialJson,
        ),
      );
    } on ConnectException catch (error) {
      throw _toPasskeyConfirmationFailure(error);
    }
  }

  Future<void> _requestEmailChange(
    AuthSession session,
    pb.RequestEmailChangeRequest Function(pb.TenantContext tenant) request,
  ) async {
    final tenantId = await _tenants.resolve();
    final body = await _auth.requestEmailChange(
      ConnectCallContext(tenantId: tenantId, accessToken: session.accessToken),
      request(pb.TenantContext(tenantId: tenantId)),
    );
    if (!body.requested) {
      throw const AuthFailure(
        AuthFailureKind.unexpected,
        message: 'RequestEmailChange answered without sending the links',
      );
    }
  }

  @override
  Future<EmailChangeProgress> confirmEmailChange(String token) async {
    final pb.ConfirmEmailChangeResponse body;
    try {
      final tenantId = await _tenants.resolve();
      body = await _auth.confirmEmailChange(
        ConnectCallContext(tenantId: tenantId),
        pb.ConfirmEmailChangeRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          token: token,
        ),
      );
    } on ConnectException catch (error) {
      // Another account took the new address after the change was asked for.
      // The link can never finish it, so it is as spent as an expired one and
      // the way on is to ask again for a different address.
      if (error.code == 'already_exists') {
        throw AuthFailure(AuthFailureKind.linkExpired, message: error.message);
      }
      throw _toLinkFailure(error);
    }
    if (body.changed) {
      return EmailChangeProgress.changed;
    }
    if (!body.confirmed) {
      throw const AuthFailure(
        AuthFailureKind.unexpected,
        message: 'ConfirmEmailChange answered without confirming the link',
      );
    }
    return body.pendingConfirmationFor.trim() == 'current_email'
        ? EmailChangeProgress.awaitingCurrentEmail
        : EmailChangeProgress.awaitingNewEmail;
  }

  @override
  Future<void> deleteAccount(
    AuthSession session, {
    required String password,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      await _auth.deleteMe(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.DeleteMeRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          password: password,
        ),
      );
    } on ConnectException catch (error) {
      throw _toAccountFailure(error);
    }
  }

  @override
  Future<void> deleteAccountWithProvider(
    AuthSession session,
    ProviderCredential credential,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      await _auth.deleteMe(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.DeleteMeRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          provider: credential.provider.wire,
          idToken: credential.idToken,
          nonce: credential.nonce,
        ),
      );
    } on ConnectException catch (error) {
      throw await _toConfirmationFailure(session, error);
    }
  }

  @override
  Future<void> deleteAccountWithPasskey(
    AuthSession session,
    String credentialJson,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      await _auth.deleteMe(
        _sessionContext(tenantId, session),
        pb.DeleteMeRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          passkeyCredentialJson: credentialJson,
        ),
      );
    } on ConnectException catch (error) {
      throw _toPasskeyConfirmationFailure(error);
    }
  }

  /// What a step confirmed with a passkey refuses with.
  ///
  /// An assertion the API does not take is `invalid_argument` on
  /// `passkey_credential_json`, apart from an address another account holds,
  /// and never `unauthenticated`, so unlike a provider's token it is never
  /// mistaken for the session's refusal.
  AuthFailure _toPasskeyConfirmationFailure(ConnectException error) {
    if (error.code == 'invalid_argument' &&
        error.fieldViolations.contains('passkey_credential_json')) {
      return AuthFailure(
        AuthFailureKind.passkeyRefused,
        message: error.message,
      );
    }
    return _toAccountFailure(error);
  }

  /// What a step confirmed with a fresh sign-in refuses with.
  ///
  /// The API answers `unauthenticated` for an ID token it cannot verify as it
  /// does for a session it no longer accepts, and only the second may sign
  /// the device out. `GetMe` tells them apart: a session it still accepts
  /// makes the refusal the sign-in's, which is the reader's to try again.
  Future<AuthFailure> _toConfirmationFailure(
    AuthSession session,
    ConnectException error,
  ) async {
    final failure = _toAccountFailure(error);
    if (failure.kind != AuthFailureKind.sessionExpired) {
      return failure;
    }
    try {
      await _getMe(session);
    } on AuthFailure catch (sessionFailure) {
      return sessionFailure;
    }
    return AuthFailure(AuthFailureKind.invalidInput, message: error.message);
  }

  @override
  Future<void> signOut(AuthSession session) async {
    try {
      final tenantId = await _tenants.resolve();
      await _auth.logout(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.LogoutRequest(tenant: pb.TenantContext(tenantId: tenantId)),
      );
    } on ConnectException catch (error) {
      throw _toAccountFailure(error);
    }
  }

  Future<pb.GetTenantResponse> _getTenant() => _readTenant(
    (service, ctx, tenant) =>
        service.getTenant(ctx, pb.GetTenantRequest(tenant: tenant)),
  );

  /// A `TenantService` read of the tenant, which [read] sends.
  Future<T> _readTenant<T>(
    Future<T> Function(
      pb.TenantServiceApi service,
      ConnectCallContext ctx,
      pb.TenantContext tenant,
    )
    read,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      return await read(
        pb.TenantServiceApi(_client),
        ConnectCallContext(tenantId: tenantId),
        pb.TenantContext(tenantId: tenantId),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// The tenant's age rule. A rung this build does not know reads as the
  /// zero value on the message, and as [AgeVerification.checked] here.
  static AgeVerification _ageVerification(pb.GetTenantResponse tenant) =>
      AgeVerification.fromWire(
        tenant.ageVerification,
        unknown: carriesUnknownEnum(tenant, _ageVerificationField),
      );

  /// The `User` behind [session], as `GetMe` answers with it.
  ///
  /// The token under test travels explicitly, so a check does not depend on
  /// the app having already adopted the session it is checking.
  Future<pb.User> _getMe(AuthSession session) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _auth.getMe(
        ConnectCallContext(
          tenantId: tenantId,
          accessToken: session.accessToken,
        ),
        pb.GetMeRequest(tenant: pb.TenantContext(tenantId: tenantId)),
      );
      return _required<pb.User>(body.hasUser(), body.user, 'user');
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

  /// [session] carrying the account [user] answers with.
  AuthSession _withUserOf(AuthSession session, pb.User user) =>
      session.withUser(
        userPublicId: user.publicId.trim(),
        userName: user.name.trim(),
        userIconUrl: userIconUrl(user.iconImageVariants, _config),
        userIconPresetId: _iconPresetId(user),
      );

  static String? _iconPresetId(pb.User user) {
    final id = user.iconPresetId.trim();
    return id.isEmpty ? null : id;
  }

  AuthSession _sessionFromLogin(pb.User user, pb.AccessToken accessToken) {
    final token = accessToken.token.trim();
    if (token.isEmpty) {
      throw const AuthFailure(
        AuthFailureKind.unexpected,
        message: 'Login returned an empty access token',
      );
    }
    return AuthSession(
      accessToken: token,
      userPublicId: user.publicId.trim(),
      userName: user.name.trim(),
      userIconUrl: userIconUrl(user.iconImageVariants, _config),
      userIconPresetId: _iconPresetId(user),
      expiresAt: DateTime.tryParse(accessToken.expiresAt.trim())?.toUtc(),
    );
  }

  /// What `LoginWithIdToken` refuses with. A missing consent is told apart by
  /// the field it names, because the API leaves the token unspent for it.
  AuthFailure _toProviderSignInFailure(ConnectException error) {
    if (error.isUnavailable) {
      return AuthFailure(AuthFailureKind.network, message: error.message);
    }
    final fields = error.fieldViolations;
    return switch (error.code) {
      'invalid_argument' when fields.contains('agreed_page_version_ids') =>
        AuthFailure(AuthFailureKind.consentRequired, message: error.message),
      'invalid_argument' when fields.contains('birth_date') => AuthFailure(
        AuthFailureKind.birthDateInvalid,
        message: error.message,
      ),
      'failed_precondition' => AuthFailure(
        AuthFailureKind.providerRefused,
        message: error.message,
      ),
      'resource_exhausted' => AuthFailure(
        AuthFailureKind.rateLimited,
        message: error.message,
      ),
      _ => AuthFailure(AuthFailureKind.unexpected, message: error.message),
    };
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

  /// What the RPCs that change the signed-in reader's own account refuse
  /// with.
  ///
  /// A wrong current password is `invalid_argument` rather than
  /// `unauthenticated`, so a typo stays a form error instead of signing the
  /// reader out. An address another account already holds is refused the same
  /// way the form refuses one it cannot send.
  AuthFailure _toAccountFailure(ConnectException error) {
    if (error.isUnavailable) {
      return AuthFailure(AuthFailureKind.network, message: error.message);
    }
    return switch (error.code) {
      'unauthenticated' => AuthFailure(
        AuthFailureKind.sessionExpired,
        message: error.message,
      ),
      'invalid_argument' || 'already_exists' => AuthFailure(
        AuthFailureKind.invalidInput,
        message: error.message,
      ),
      'resource_exhausted' => AuthFailure(
        AuthFailureKind.rateLimited,
        message: error.message,
      ),
      'failed_precondition'
          when error.reasons.contains(lastTenantAdminReason) =>
        AuthFailure(AuthFailureKind.lastTenantAdmin, message: error.message),
      _ => AuthFailure(AuthFailureKind.unexpected, message: error.message),
    };
  }

  /// What the RPCs that add and name the reader's passkeys refuse with.
  ///
  /// A credential that does not verify is `invalid_argument`, which reads as
  /// invalidInput rather than as an ended session.
  AuthFailure _toPasskeyFailure(ConnectException error) => switch (error.code) {
    'failed_precondition' => AuthFailure(
      AuthFailureKind.passkeyLimit,
      message: error.message,
    ),
    'already_exists' => AuthFailure(
      AuthFailureKind.passkeyAlreadyRegistered,
      message: error.message,
    ),
    'not_found' => AuthFailure(
      AuthFailureKind.passkeyNotFound,
      message: error.message,
    ),
    _ => _toAccountFailure(error),
  };

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

  /// [message] where the answer carried it, as [present] tells. An answer
  /// without it is one this build cannot use.
  T _required<T>(bool present, T message, String path) {
    if (!present) {
      throw AuthFailure(
        AuthFailureKind.unexpected,
        message: '$path is missing',
      );
    }
    return message;
  }

  /// [text] where the answer carried any. The options a passkey ceremony
  /// runs over are nothing the authenticator can read without it.
  String _requiredText(String text, String path) =>
      _required(text.trim().isNotEmpty, text, path);
}
