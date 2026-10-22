import 'dart:async';
import 'dart:io';

import 'package:fixnum/fixnum.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:protobuf/protobuf.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/auth.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/tenant.pb.dart' as pb;
import 'package:publira/auth/account_icon.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/email_change.dart';
import 'package:publira/auth/http_auth_repository.dart';
import 'package:publira/auth/notification_settings.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/auth/reader_icon_policy.dart';
import 'package:publira/auth/sign_up_requirements.dart';
import 'package:publira/config.dart';

import 'support/connect_fixture_server.dart';
import 'support/icon_images.dart';

void main() {
  late ConnectFixtureServer server;
  late HttpAuthRepository auth;

  setUp(() async {
    server = ConnectFixtureServer();
    await server.start();
    auth = HttpAuthRepository(
      config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
    );
  });

  tearDown(() async {
    await server.close();
  });

  test('signIn returns the session the API issued', () async {
    final session = await auth.signIn(
      email: ConnectFixtureServer.memberEmail,
      password: ConnectFixtureServer.memberPassword,
    );

    expect(session.accessToken, ConnectFixtureServer.memberAccessToken);
    expect(session.userPublicId, ConnectFixtureServer.memberPublicId);
    expect(session.userName, ConnectFixtureServer.memberName);
    expect(session.expiresAt, isNotNull);
    expect(session.hasExpired(DateTime.now()), isFalse);
  });

  test('signIn maps rejected credentials to invalidCredentials', () async {
    expect(
      () => auth.signIn(
        email: ConnectFixtureServer.memberEmail,
        password: 'wrong',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.invalidCredentials,
        ),
      ),
    );
  });

  test('signIn maps an unreachable API to network', () async {
    final closedBaseUrl = server.baseUrl;
    await server.close();
    final offline = HttpAuthRepository(
      config: AppConfig(baseUrl: closedBaseUrl, tenantHost: 'localhost'),
    );

    expect(
      () => offline.signIn(
        email: ConnectFixtureServer.memberEmail,
        password: ConnectFixtureServer.memberPassword,
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.network,
        ),
      ),
    );
  });

  test('refresh confirms a stored token and re-reads its user', () async {
    const stored = AuthSession(
      accessToken: ConnectFixtureServer.memberAccessToken,
      userPublicId: '',
      userName: '',
    );

    final refreshed = await auth.refresh(stored);

    expect(refreshed.accessToken, ConnectFixtureServer.memberAccessToken);
    expect(refreshed.userName, ConnectFixtureServer.memberName);
    expect(refreshed.userPublicId, ConnectFixtureServer.memberPublicId);
  });

  test('refresh reads the icon the account shows, or none', () async {
    const stored = AuthSession(
      accessToken: ConnectFixtureServer.memberAccessToken,
      userPublicId: '',
      userName: '',
    );

    expect((await auth.refresh(stored)).userIconUrl, isNull);

    server.memberIconPath =
        '/images/users/0190a0c0-0000-7000-8000-000000000002';
    final refreshed = await auth.refresh(stored);

    expect(
      refreshed.userIconUrl,
      Uri.parse(
        '${server.baseUrl}/images/users/0190a0c0-0000-7000-8000-000000000002',
      ),
    );
    // The session is what a restart reads back, icon included.
    expect(
      AuthSession.fromJson(refreshed.toJson())?.userIconUrl,
      refreshed.userIconUrl,
    );
  });

  const stored = AuthSession(
    accessToken: ConnectFixtureServer.memberAccessToken,
    userPublicId: ConnectFixtureServer.memberPublicId,
    userName: ConnectFixtureServer.memberName,
  );

  test('readReaderAge reports the date and the tenant rule', () async {
    server.memberBirthDate = '1990-04-02';

    final age = await auth.readReaderAge(stored);

    expect(age.birthDate, '1990-04-02');
    expect(age.timeZone, 'UTC');
    expect(age.verification, AgeVerification.checked);
  });

  test('readEmail reports the address the account holds', () async {
    expect(await auth.readEmail(stored), ConnectFixtureServer.memberEmail);
  });

  test('readReaderAge reports an account that holds none', () async {
    server.ageVerification = pb.AgeVerification.AGE_VERIFICATION_NONE;

    final age = await auth.readReaderAge(stored);

    expect(age.hasBirthDate, isFalse);
    expect(age.verification, AgeVerification.none);
  });

  test(
    'readReaderAge reports a tenant read that fails before GetMe answers',
    () async {
      final client = _HoldingClient(baseUrl: server.baseUrl, held: 'GetMe');
      final holding = HttpAuthRepository(
        config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
        client: client,
      );
      // Resolved once while the API answers, so only the read fails.
      await holding.readReaderAge(stored);
      server.tenantStatus = HttpStatus.serviceUnavailable;
      client.release = client.settled.firstWhere(
        (procedure) => procedure.endsWith('/GetTenant'),
      );

      await expectLater(
        holding.readReaderAge(stored),
        throwsA(
          isA<AuthFailure>().having(
            (failure) => failure.kind,
            'kind',
            AuthFailureKind.network,
          ),
        ),
      );
    },
  );

  test(
    'readReaderAge reports a rejected session without waiting on the tenant',
    () async {
      final client = _HoldingClient(baseUrl: server.baseUrl, held: 'GetTenant');
      final holding = HttpAuthRepository(
        config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
        client: client,
      );
      final tenantAnswers = Completer<void>();
      addTearDown(tenantAnswers.complete);
      client.release = tenantAnswers.future;
      server.activeAccessToken = 'another-token';

      await expectLater(
        holding.readReaderAge(stored),
        throwsA(
          isA<AuthFailure>().having(
            (failure) => failure.kind,
            'kind',
            AuthFailureKind.sessionExpired,
          ),
        ),
      );
    },
  );

  test('recordBirthDate writes the date beside the name it holds', () async {
    final written = await auth.recordBirthDate(
      stored.withUser(
        userPublicId: stored.userPublicId,
        userName: 'Stale',
        userIconUrl: null,
        userIconPresetId: null,
      ),
      DateTime.utc(2001, 2, 3),
    );

    expect(written, '2001-02-03');
    expect(server.memberBirthDate, '2001-02-03');
    final request = server.requestsOf(pb.UpdateMeRequest.new).single;
    expect(request.name, ConnectFixtureServer.memberName);
    expect(request.birthDate, '2001-02-03');
  });

  test('recordBirthDate maps a date the API refuses to birthDateInvalid', () {
    final unreached = DateTime.now().toUtc().add(const Duration(days: 2));

    expect(
      () => auth.recordBirthDate(stored, unreached),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.birthDateInvalid,
        ),
      ),
    );
  });

  test('recordBirthDate maps a date already set to birthDateAlreadySet', () {
    server.memberBirthDate = '1990-04-02';

    expect(
      () => auth.recordBirthDate(stored, DateTime.utc(2001, 2, 3)),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.birthDateAlreadySet,
        ),
      ),
    );
  });

  test('signUp sends what the form collected', () async {
    await auth.signUp(
      name: 'New Reader',
      email: 'new@example.com',
      password: 'newpassword',
      birthDate: '1998-07-06',
    );

    final request = server.requestsOf(pb.CreateUserRequest.new).single;
    expect(request.name, 'New Reader');
    expect(request.email, 'new@example.com');
    expect(request.password, 'newpassword');
    expect(request.birthDate, '1998-07-06');
  });

  test('signUp sends the page versions the reader agreed to', () async {
    await auth.signUp(
      name: 'New Reader',
      email: 'new@example.com',
      password: 'newpassword',
      agreedPageVersionIds: ['terms-v2', 'privacy-v1'],
    );

    expect(server.signups['new@example.com']!.agreedPageVersionIds, [
      'terms-v2',
      'privacy-v1',
    ]);
  });

  test('signUp leaves out a birth date the form did not ask for', () async {
    await auth.signUp(
      name: 'New Reader',
      email: 'new@example.com',
      password: 'newpassword',
    );

    final request = server.requestsOf(pb.CreateUserRequest.new).single;
    expect(request.hasBirthDate(), isFalse);
    expect(request.agreedPageVersionIds, isEmpty);
  });

  test('signUp maps a refused address to invalidInput', () async {
    server.signupStatus = HttpStatus.badRequest;
    server.signupErrorCode = 'invalid_argument';

    await expectLater(
      auth.signUp(
        name: 'New Reader',
        email: 'not-an-address',
        password: 'newpassword',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.invalidInput,
        ),
      ),
    );
  });

  test('signUp maps a spent mail allowance to rateLimited', () async {
    server.signupStatus = HttpStatus.tooManyRequests;
    server.signupErrorCode = 'resource_exhausted';

    await expectLater(
      auth.signUp(
        name: 'New Reader',
        email: 'new@example.com',
        password: 'newpassword',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.rateLimited,
        ),
      ),
    );
  });

  test('verifyEmail confirms the address a sign-up left unconfirmed', () async {
    await auth.signUp(
      name: 'New Reader',
      email: 'new@example.com',
      password: 'newpassword',
    );

    await auth.verifyEmail(ConnectFixtureServer.verificationToken);

    expect(server.signups['new@example.com']!.verified, isTrue);
  });

  test(
    'a reader who signed up reads their own account once signed in',
    () async {
      await auth.signUp(
        name: 'New Reader',
        email: 'new@example.com',
        password: 'newpassword',
      );
      await auth.verifyEmail(ConnectFixtureServer.verificationToken);
      final session = await auth.signIn(
        email: 'new@example.com',
        password: 'newpassword',
      );

      expect(await auth.readEmail(session), 'new@example.com');
      expect((await auth.readReaderAge(session)).birthDate, isEmpty);
    },
  );

  test('verifyEmail maps an unknown token to linkInvalid', () {
    expect(
      () => auth.verifyEmail('never-issued'),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.linkInvalid,
        ),
      ),
    );
  });

  test('verifyEmail maps a spent link to linkExpired', () {
    expect(
      () => auth.verifyEmail(ConnectFixtureServer.expiredVerificationToken),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.linkExpired,
        ),
      ),
    );
  });

  test('requestEmailVerification names the address it was given', () async {
    await auth.requestEmailVerification('new@example.com');

    expect(
      server.requestsOf(pb.RequestEmailVerificationRequest.new).single.email,
      'new@example.com',
    );
  });

  test('requestEmailVerification maps a spent allowance to rateLimited', () {
    server.verificationRequestStatus = HttpStatus.tooManyRequests;
    server.verificationRequestErrorCode = 'resource_exhausted';

    expect(
      () => auth.requestEmailVerification('new@example.com'),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.rateLimited,
        ),
      ),
    );
  });

  test('requestPasswordReset names the address it was given', () async {
    await auth.requestPasswordReset(ConnectFixtureServer.memberEmail);

    expect(
      server.requestsOf(pb.RequestPasswordResetRequest.new).single.email,
      ConnectFixtureServer.memberEmail,
    );
  });

  test('requestPasswordReset maps a spent allowance to rateLimited', () {
    server.passwordResetRequestStatus = HttpStatus.tooManyRequests;
    server.passwordResetRequestErrorCode = 'resource_exhausted';

    expect(
      () => auth.requestPasswordReset(ConnectFixtureServer.memberEmail),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.rateLimited,
        ),
      ),
    );
  });

  test('confirmPasswordReset sets the password Login then takes', () async {
    await auth.confirmPasswordReset(
      token: ConnectFixtureServer.passwordResetToken,
      newPassword: 'replaced-password',
    );

    final session = await auth.signIn(
      email: ConnectFixtureServer.memberEmail,
      password: 'replaced-password',
    );
    expect(session.userPublicId, ConnectFixtureServer.memberPublicId);
  });

  test('confirmPasswordReset maps an unknown token to linkInvalid', () {
    expect(
      () => auth.confirmPasswordReset(
        token: 'never-issued',
        newPassword: 'replaced-password',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.linkInvalid,
        ),
      ),
    );
  });

  test('confirmPasswordReset maps a spent link to linkExpired', () {
    expect(
      () => auth.confirmPasswordReset(
        token: ConnectFixtureServer.expiredPasswordResetToken,
        newPassword: 'replaced-password',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.linkExpired,
        ),
      ),
    );
  });

  test('confirmPasswordReset maps a blank password to invalidInput', () {
    expect(
      () => auth.confirmPasswordReset(
        token: ConnectFixtureServer.passwordResetToken,
        newPassword: '   ',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.invalidInput,
        ),
      ),
    );
  });

  test(
    'readSignUpRequirements reports the tenant rule without a session',
    () async {
      expect(
        (await auth.readSignUpRequirements(locale: 'en')).ageVerification,
        AgeVerification.checked,
      );

      server.ageVerification = pb.AgeVerification.AGE_VERIFICATION_NONE;

      expect(
        (await auth.readSignUpRequirements(locale: 'en')).ageVerification,
        AgeVerification.none,
      );
      expect(server.requestsTo('GetTenant'), hasLength(2));
    },
  );

  test('readSignUpRequirements reads the pages the tenant names', () async {
    server
      ..termsPage = pb.TenantLegalPage(
        slug: '/legal/terms',
        title: ' Terms of service ',
        versionId: 'terms-v2',
      )
      ..privacyPage = pb.TenantLegalPage(
        slug: '/privacy',
        title: 'Privacy policy',
      );

    final requirements = await auth.readSignUpRequirements(locale: 'en');

    expect(
      requirements.termsPage,
      const LegalPage(
        slug: '/legal/terms',
        title: 'Terms of service',
        versionId: 'terms-v2',
      ),
    );
    // A page named without a published version is not one to agree to.
    expect(requirements.privacyPage, isNull);
    expect(requirements.legalPages, [requirements.termsPage]);
  });

  test('readSignUpRequirements reads the pages in a locale', () async {
    server.termsPage = pb.TenantLegalPage(
      slug: '/legal/terms',
      title: 'Terms of service',
      versionId: 'terms-ja-v1',
      locale: 'ja',
    );

    final requirements = await auth.readSignUpRequirements(locale: 'ja');

    expect(requirements.termsPage?.versionId, 'terms-ja-v1');
    expect(
      server.requestsOf(pb.GetTenantLegalPagesRequest.new).single,
      pb.GetTenantLegalPagesRequest(tenant: _defaultTenant(), locale: 'ja'),
    );
  });

  test(
    'readSignUpRequirements reports an unreachable tenant as a network failure',
    () async {
      // Resolved once while the API answers, so only the reads fail.
      await auth.readSignUpRequirements(locale: 'en');
      server.tenantStatus = HttpStatus.serviceUnavailable;

      await expectLater(
        auth.readSignUpRequirements(locale: 'en'),
        throwsA(
          isA<AuthFailure>().having(
            (failure) => failure.kind,
            'kind',
            AuthFailureKind.network,
          ),
        ),
      );
    },
  );

  group('legal page agreements', () {
    final terms = pb.TenantLegalPage(
      slug: '/legal/terms',
      title: 'Terms of service',
      versionId: 'terms-v2',
    );
    final privacy = pb.TenantLegalPage(
      slug: '/privacy',
      title: 'Privacy policy',
      versionId: 'privacy-v3',
    );

    test('reads the pages the reader owes, terms first', () async {
      server
        ..owedTermsPage = terms
        ..owedPrivacyPage = privacy;

      final owed = await auth.readOwedLegalPages(stored, locale: 'ja');

      expect(owed.map((page) => page.versionId), ['terms-v2', 'privacy-v3']);
      final request = server.requestsTo('GetMyLegalPageAgreements').single;
      expect(
        request.decode(pb.GetMyLegalPageAgreementsRequest()),
        pb.GetMyLegalPageAgreementsRequest(
          tenant: _defaultTenant(),
          locale: 'ja',
        ),
      );
      expect(
        request.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
    });

    test('reads nothing owed as an empty list', () async {
      expect(await auth.readOwedLegalPages(stored, locale: 'en'), isEmpty);
    });

    test('a page named for both roles is owed once', () async {
      server
        ..owedTermsPage = terms
        ..owedPrivacyPage = terms;

      final owed = await auth.readOwedLegalPages(stored, locale: 'en');

      expect(owed.map((page) => page.versionId), ['terms-v2']);
    });

    test('an agreement answers with what the reader still owes', () async {
      server
        ..owedTermsPage = terms
        ..owedPrivacyPage = privacy;

      final owed = await auth.agreeToLegalPages(
        stored,
        agreedPageVersionIds: ['terms-v2'],
        locale: 'en',
      );

      expect(owed.map((page) => page.versionId), ['privacy-v3']);
      expect(
        server.requestsOf(pb.AgreeToLegalPagesRequest.new).single,
        pb.AgreeToLegalPagesRequest(
          tenant: _defaultTenant(),
          agreedPageVersionIds: ['terms-v2'],
          locale: 'en',
        ),
      );
    });

    test('maps a version the tenant no longer asks about to invalidInput', () {
      server.owedTermsPage = terms;

      expect(
        () => auth.agreeToLegalPages(
          stored,
          agreedPageVersionIds: ['terms-v1'],
          locale: 'en',
        ),
        throwsA(
          isA<AuthFailure>().having(
            (failure) => failure.kind,
            'kind',
            AuthFailureKind.invalidInput,
          ),
        ),
      );
    });

    test('maps a rejected session to sessionExpired', () {
      server.activeAccessToken = 'another-token';

      expect(
        () => auth.readOwedLegalPages(stored, locale: 'en'),
        throwsA(
          isA<AuthFailure>().having(
            (failure) => failure.kind,
            'kind',
            AuthFailureKind.sessionExpired,
          ),
        ),
      );
    });
  });

  test('refresh maps a token the API rejects to sessionExpired', () async {
    server.activeAccessToken = 'another-token';
    const stored = AuthSession(
      accessToken: ConnectFixtureServer.memberAccessToken,
      userPublicId: ConnectFixtureServer.memberPublicId,
      userName: ConnectFixtureServer.memberName,
    );

    expect(
      () => auth.refresh(stored),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.sessionExpired,
        ),
      ),
    );
  });

  Matcher failsWith(AuthFailureKind kind) => throwsA(
    isA<AuthFailure>().having((failure) => failure.kind, 'kind', kind),
  );

  test('updateName renames the account and the session with it', () async {
    final updated = await auth.updateName(stored, 'Renamed Reader');

    expect(updated.userName, 'Renamed Reader');
    expect(updated.accessToken, stored.accessToken);
    expect(server.memberCurrentName, 'Renamed Reader');
    final request = server.requestsOf(pb.UpdateMeRequest.new).single;
    expect(request.hasBirthDate(), isFalse);
  });

  test('updateName keeps the icon the account shows', () async {
    server.memberIconPath =
        '/images/users/0190a0c0-0000-7000-8000-000000000003';

    final updated = await auth.updateName(stored, 'Renamed Reader');

    expect(
      updated.userIconUrl,
      Uri.parse(
        '${server.baseUrl}/images/users/0190a0c0-0000-7000-8000-000000000003',
      ),
    );
  });

  test('updateName maps a name the API refuses to invalidInput', () {
    expect(
      () => auth.updateName(stored, '   '),
      failsWith(AuthFailureKind.invalidInput),
    );
  });

  test(
    'uploadIcon sends the image and takes the icon the API answers with',
    () async {
      final image = pngIcon();

      final updated = await auth.uploadIcon(
        stored,
        AccountIconUpload(bytes: image, contentType: 'image/png'),
      );

      final upload = server.iconUploads.single;
      expect(upload.bytes, image);
      expect(upload.contentType, 'image/png');
      expect(
        updated.userIconUrl,
        Uri.parse('${server.baseUrl}${server.memberIconPath}'),
      );
      expect(updated.userName, ConnectFixtureServer.memberName);
      expect(updated.accessToken, stored.accessToken);
    },
  );

  test('removeIcon leaves the session with no icon', () async {
    server.memberIconPath =
        '/images/users/0190a0c0-0000-7000-8000-000000000003';

    final updated = await auth.removeIcon(
      stored.withUser(
        userPublicId: stored.userPublicId,
        userName: stored.userName,
        userIconUrl: Uri.parse(
          '${server.baseUrl}/images/users/0190a0c0-0000-7000-8000-000000000003',
        ),
        userIconPresetId: null,
      ),
    );

    expect(server.iconRemovals, 1);
    expect(updated.userIconUrl, isNull);
  });

  test('uploadIcon maps an image the API refuses to iconRefused', () {
    expect(
      () => auth.uploadIcon(
        stored,
        AccountIconUpload(bytes: pngIcon(), contentType: 'text/plain'),
      ),
      failsWith(AuthFailureKind.iconRefused),
    );
  });

  test('uploadIcon maps an install without an object store to '
      'storageNotConfigured', () {
    server.iconStorageConfigured = false;

    expect(
      () => auth.uploadIcon(
        stored,
        AccountIconUpload(bytes: pngIcon(), contentType: 'image/png'),
      ),
      failsWith(AuthFailureKind.storageNotConfigured),
    );
  });

  test('uploadIcon maps a tenant that takes no upload to iconNotAllowed', () {
    server.readerIconPolicy = pb.ReaderIconPolicy.READER_ICON_POLICY_PRESET;

    expect(
      () => auth.uploadIcon(
        stored,
        AccountIconUpload(bytes: pngIcon(), contentType: 'image/png'),
      ),
      failsWith(AuthFailureKind.iconNotAllowed),
    );
  });

  group('the reader icon policy', () {
    test('readIconChoice reads an upload policy', () async {
      expect(await auth.readIconChoice(), isA<ReaderIconUpload>());
    });

    test('readIconChoice reads the presets that have an image', () async {
      server
        ..readerIconPolicy = pb.ReaderIconPolicy.READER_ICON_POLICY_PRESET
        ..readerIconPresets = [
          ConnectFixtureServer.readerIconPreset('preset-a'),
          pb.ReaderIconPreset(id: 'preset-without-image'),
          ConnectFixtureServer.readerIconPreset('preset-b'),
        ];

      final choice = await auth.readIconChoice();

      expect(choice, isA<ReaderIconPresets>());
      final presets = (choice as ReaderIconPresets).presets;
      expect(presets.map((preset) => preset.id), ['preset-a', 'preset-b']);
      expect(
        presets.first.iconUrl,
        Uri.parse(
          '${server.baseUrl}'
          '${ConnectFixtureServer.readerIconPresetPath('preset-a')}',
        ),
      );
    });

    test('readIconChoice reads a disabled policy', () async {
      server.readerIconPolicy = pb.ReaderIconPolicy.READER_ICON_POLICY_DISABLED;

      expect(await auth.readIconChoice(), isA<ReaderIconDisabled>());
    });

    test(
      'readIconChoice offers nothing under a policy it does not know',
      () async {
        server.readerIconPolicyResponse = pb.GetTenantReaderIconPolicyResponse()
          ..unknownFields.mergeVarintField(1, Int64(999));

        expect(await auth.readIconChoice(), isA<ReaderIconDisabled>());
      },
    );

    test('readIconChoice maps an unreachable API to network', () async {
      final closedBaseUrl = server.baseUrl;
      await server.close();
      final offline = HttpAuthRepository(
        config: AppConfig(baseUrl: closedBaseUrl, tenantHost: 'localhost'),
      );

      await expectLater(
        offline.readIconChoice,
        failsWith(AuthFailureKind.network),
      );
    });

    test(
      'selectIcon shows the preset and takes the icon the API answers with',
      () async {
        server
          ..readerIconPolicy = pb.ReaderIconPolicy.READER_ICON_POLICY_PRESET
          ..readerIconPresets = [
            ConnectFixtureServer.readerIconPreset('preset-a'),
          ];

        final updated = await auth.selectIcon(stored, 'preset-a');

        expect(server.iconSelections, ['preset-a']);
        expect(updated.userIconPresetId, 'preset-a');
        expect(
          updated.userIconUrl,
          Uri.parse(
            '${server.baseUrl}'
            '${ConnectFixtureServer.readerIconPresetPath('preset-a')}',
          ),
        );
        // The session is what a restart reads back, the preset included.
        expect(
          AuthSession.fromJson(updated.toJson())?.userIconPresetId,
          'preset-a',
        );

        final refreshed = await auth.refresh(stored);
        expect(refreshed.userIconPresetId, 'preset-a');

        final removed = await auth.removeIcon(updated);
        expect(removed.userIconPresetId, isNull);
        expect(removed.userIconUrl, isNull);
      },
    );

    test('selectIcon maps a preset the tenant does not hold to '
        'iconPresetUnavailable', () {
      server.readerIconPolicy = pb.ReaderIconPolicy.READER_ICON_POLICY_PRESET;

      expect(
        () => auth.selectIcon(stored, 'deleted-preset'),
        failsWith(AuthFailureKind.iconPresetUnavailable),
      );
    });

    test('selectIcon maps a tenant that offers no presets to '
        'iconNotAllowed', () {
      expect(
        () => auth.selectIcon(stored, 'preset-a'),
        failsWith(AuthFailureKind.iconNotAllowed),
      );
    });
  });

  test('removeIcon maps a session the API refuses to sessionExpired', () {
    server.activeAccessToken = 'another-token';

    expect(
      () => auth.removeIcon(stored),
      failsWith(AuthFailureKind.sessionExpired),
    );
  });

  test('changePassword hands back the token that replaces this one', () async {
    final changed = await auth.changePassword(
      stored,
      currentPassword: ConnectFixtureServer.memberPassword,
      newPassword: 'replaced-password',
    );

    expect(
      changed.accessToken,
      ConnectFixtureServer.changedPasswordAccessToken,
    );
    expect(changed.userPublicId, stored.userPublicId);
    expect(changed.expiresAt, isNotNull);
    expect(server.memberCurrentPassword, 'replaced-password');
    await expectLater(
      () => auth.refresh(stored),
      failsWith(AuthFailureKind.sessionExpired),
    );
    expect((await auth.refresh(changed)).userName, stored.userName);
  });

  test('changePassword maps a wrong current password to invalidInput', () {
    expect(
      () => auth.changePassword(
        stored,
        currentPassword: 'mistyped-password',
        newPassword: 'replaced-password',
      ),
      failsWith(AuthFailureKind.invalidInput),
    );
  });

  test('changePassword maps a rejected session to sessionExpired', () {
    server.activeAccessToken = 'another-token';

    expect(
      () => auth.changePassword(
        stored,
        currentPassword: ConnectFixtureServer.memberPassword,
        newPassword: 'replaced-password',
      ),
      failsWith(AuthFailureKind.sessionExpired),
    );
  });

  test('requestEmailChange sends both addresses and the password', () async {
    await auth.requestEmailChange(
      stored,
      currentEmail: ConnectFixtureServer.memberEmail,
      newEmail: 'moved@example.com',
      currentPassword: ConnectFixtureServer.memberPassword,
    );

    expect(server.requestedEmailChanges, ['moved@example.com']);
  });

  test('requestEmailChange maps an address already taken to invalidInput', () {
    expect(
      () => auth.requestEmailChange(
        stored,
        currentEmail: ConnectFixtureServer.memberEmail,
        newEmail: ConnectFixtureServer.takenEmail,
        currentPassword: ConnectFixtureServer.memberPassword,
      ),
      failsWith(AuthFailureKind.invalidInput),
    );
  });

  test('requestEmailChange maps a wrong password to invalidInput', () {
    expect(
      () => auth.requestEmailChange(
        stored,
        currentEmail: ConnectFixtureServer.memberEmail,
        newEmail: 'moved@example.com',
        currentPassword: 'mistyped-password',
      ),
      failsWith(AuthFailureKind.invalidInput),
    );
  });

  test(
    'confirmEmailChange reports a change both links have finished',
    () async {
      expect(
        await auth.confirmEmailChange(ConnectFixtureServer.emailChangeToken),
        EmailChangeProgress.changed,
      );
    },
  );

  test('confirmEmailChange reports the link still waited on', () async {
    expect(
      await auth.confirmEmailChange(
        ConnectFixtureServer.pendingEmailChangeToken,
      ),
      EmailChangeProgress.awaitingCurrentEmail,
    );
    final request = server.requestsTo('ConfirmEmailChange').single;
    expect(request.headers['authorization'], isNull);
  });

  test('confirmEmailChange maps an unknown token to linkInvalid', () {
    expect(
      () => auth.confirmEmailChange('never-issued'),
      failsWith(AuthFailureKind.linkInvalid),
    );
  });

  test('confirmEmailChange maps a spent link to linkExpired', () {
    expect(
      () =>
          auth.confirmEmailChange(ConnectFixtureServer.expiredEmailChangeToken),
      failsWith(AuthFailureKind.linkExpired),
    );
  });

  test('confirmEmailChange maps an address taken meanwhile to linkExpired', () {
    expect(
      () => auth.confirmEmailChange(
        ConnectFixtureServer.conflictingEmailChangeToken,
      ),
      failsWith(AuthFailureKind.linkExpired),
    );
  });

  test('deleteAccount leaves nothing to sign in to', () async {
    await auth.deleteAccount(
      stored,
      password: ConnectFixtureServer.memberPassword,
    );

    await expectLater(
      () => auth.refresh(stored),
      failsWith(AuthFailureKind.sessionExpired),
    );
    await expectLater(
      () => auth.signIn(
        email: ConnectFixtureServer.memberEmail,
        password: ConnectFixtureServer.memberPassword,
      ),
      failsWith(AuthFailureKind.invalidCredentials),
    );
  });

  test('deleteAccount maps a wrong password to invalidInput', () async {
    await expectLater(
      () => auth.deleteAccount(stored, password: 'mistyped-password'),
      failsWith(AuthFailureKind.invalidInput),
    );
    expect(server.memberDeleted, isFalse);
  });

  test('deleteAccount maps the last tenant admin to lastTenantAdmin', () async {
    server.memberIsLastTenantAdmin = true;

    await expectLater(
      () => auth.deleteAccount(
        stored,
        password: ConnectFixtureServer.memberPassword,
      ),
      failsWith(AuthFailureKind.lastTenantAdmin),
    );
    expect(server.memberDeleted, isFalse);
  });

  test(
    'signOut sends Logout for the tenant with the token being dropped',
    () async {
      await auth.signOut(stored);

      final request = server.requestsTo('Logout').single;
      expect(request.headers['authorization'], 'Bearer ${stored.accessToken}');
      expect(request.decode(pb.LogoutRequest()).tenant, _defaultTenant());
    },
  );

  group('notification settings', () {
    const allOn = NotificationSettings(preferences: {});

    test('reads the settings the account holds', () async {
      final settings = await auth.readNotificationSettings(stored);
      expect(notificationCells.every(settings.isEnabled), isTrue);

      server.memberNotificationPreferences
        ..commentsInboxEnabled = false
        ..commentsEmailEnabled = false;

      final changed = await auth.readNotificationSettings(stored);
      expect(
        [
          for (final cell in notificationCells)
            if (!changed.isEnabled(cell)) cell,
        ],
        [
          (NotificationCategory.comments, NotificationChannel.inbox),
          (NotificationCategory.comments, NotificationChannel.email),
        ],
      );
    });

    test('writes the email cells it is given and no other', () async {
      final settings = await auth.updateNotificationSettings(
        stored,
        current: allOn,
        cells: {
          (NotificationCategory.comments, NotificationChannel.email): false,
        },
      );

      final request = server.requestsTo('UpdateNotificationSettings').single;
      expect(request.headers['authorization'], 'Bearer ${stored.accessToken}');
      expect(
        request.decode(pb.UpdateNotificationSettingsRequest()),
        pb.UpdateNotificationSettingsRequest(
          tenant: _defaultTenant(),
          commentsEmailEnabled: false,
        ),
      );
      expect(
        [
          for (final cell in notificationCells)
            if (!settings.isEnabled(cell)) cell,
        ],
        [(NotificationCategory.comments, NotificationChannel.email)],
      );
    });

    test('writes the cells it is given in one request, with every email cell '
        'as the reader was shown it', () async {
      server.memberNotificationPreferences.announcementsEmailEnabled = false;
      final current = allOn.copyWith(
        cells: {
          (NotificationCategory.announcements, NotificationChannel.email):
              false,
        },
      );

      final settings = await auth.updateNotificationSettings(
        stored,
        current: current,
        cells: {
          (NotificationCategory.followedCreators, NotificationChannel.inbox):
              false,
          (
            NotificationCategory.followedCreators,
            NotificationChannel.mobilePush,
          ): false,
        },
      );

      final request = server.requestsTo('UpdateNotificationSettings').single;
      expect(
        request.decode(pb.UpdateNotificationSettingsRequest()),
        pb.UpdateNotificationSettingsRequest(
          tenant: _defaultTenant(),
          followedCreatorsInboxEnabled: false,
          followedCreatorsMobilePushEnabled: false,
          followedEpisodesEmailEnabled: true,
          followedCreatorsEmailEnabled: true,
          commentsEmailEnabled: true,
          announcementsEmailEnabled: false,
        ),
      );
      expect(
        [
          for (final cell in notificationCells)
            if (!settings.isEnabled(cell)) cell,
        ],
        [
          (NotificationCategory.followedCreators, NotificationChannel.inbox),
          (
            NotificationCategory.followedCreators,
            NotificationChannel.mobilePush,
          ),
          (NotificationCategory.announcements, NotificationChannel.email),
        ],
      );
    });

    test('maps a rejected token to sessionExpired', () async {
      server.activeAccessToken = 'another-token';

      await expectLater(
        () => auth.readNotificationSettings(stored),
        failsWith(AuthFailureKind.sessionExpired),
      );
      await expectLater(
        () => auth.updateNotificationSettings(stored, current: allOn),
        failsWith(AuthFailureKind.sessionExpired),
      );
    });

    test('maps an unreachable API to network', () async {
      final closedBaseUrl = server.baseUrl;
      await server.close();
      final offline = HttpAuthRepository(
        config: AppConfig(baseUrl: closedBaseUrl, tenantHost: 'localhost'),
      );

      await expectLater(
        () => offline.updateNotificationSettings(stored, current: allOn),
        failsWith(AuthFailureKind.network),
      );
    });
  });

  test('signOut maps an unreachable API to network', () async {
    final closedBaseUrl = server.baseUrl;
    await server.close();
    final offline = HttpAuthRepository(
      config: AppConfig(baseUrl: closedBaseUrl, tenantHost: 'localhost'),
    );

    await expectLater(
      () => offline.signOut(stored),
      failsWith(AuthFailureKind.network),
    );
  });
}

/// The tenant every request names, as the fixture serves it.
pb.TenantContext _defaultTenant() =>
    pb.TenantContext(tenantId: ConnectFixtureServer.defaultTenantId);

/// Sends [held] only once [release] completes, so a test can decide which of
/// two reads settles first.
class _HoldingClient extends ConnectClient {
  _HoldingClient({required super.baseUrl, required this.held});

  final String held;
  Future<void> release = Future.value();

  final _settled = StreamController<String>.broadcast();

  /// The procedure of each call as it settles, successfully or not.
  Stream<String> get settled => _settled.stream;

  @override
  Future<T> invoke<T extends GeneratedMessage>(
    ClientContext? ctx,
    String serviceName,
    String methodName,
    GeneratedMessage request,
    T emptyResponse,
  ) async {
    if (methodName == held) {
      await release;
    }
    try {
      return await super.invoke(
        ctx,
        serviceName,
        methodName,
        request,
        emptyResponse,
      );
    } finally {
      _settled.add('$serviceName/$methodName');
    }
  }
}
