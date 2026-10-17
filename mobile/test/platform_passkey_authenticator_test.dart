import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:passkeys_platform_interface/passkeys_platform_interface.dart';
import 'package:passkeys_platform_interface/types/types.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/platform_passkey_authenticator.dart';

/// Creation options as the API's relying party writes them: a credential to
/// exclude that reported no transports carries none.
const _creationOptions = '''
{
  "rp": {"name": "Example Reader", "id": "reader.example.com"},
  "user": {"name": "member@example.com", "displayName": "Sample Member", "id": "U2VlZE1NQlJBQUEx"},
  "challenge": "Y3JlYXRl",
  "pubKeyCredParams": [{"type": "public-key", "alg": -7}, {"type": "public-key", "alg": -257}],
  "timeout": 300000,
  "excludeCredentials": [
    {"type": "public-key", "id": "c2F2ZWQ"},
    {"type": "public-key", "id": "a2V5", "transports": ["usb"]}
  ],
  "authenticatorSelection": {"requireResidentKey": true, "residentKey": "required", "userVerification": "required"},
  "attestation": "none"
}
''';

/// Request options for a sign-in that names no account.
const _requestOptions = '''
{"challenge": "YXNzZXJ0", "timeout": 300000, "rpId": "reader.example.com", "userVerification": "required"}
''';

class _FakePasskeysPlatform extends PasskeysPlatform {
  RegisterRequestType? registered;
  AuthenticateRequestType? authenticated;
  PlatformException? failure;
  PlatformException? availabilityFailure;
  var supported = true;

  @override
  Future<RegisterResponseType> register(RegisterRequestType request) async {
    registered = request;
    final failure = this.failure;
    if (failure != null) {
      throw failure;
    }
    return const RegisterResponseType(
      id: 'bmV3',
      rawId: 'bmV3',
      clientDataJSON: 'Y2xpZW50',
      attestationObject: 'YXR0ZXN0',
      transports: ['internal', 'hybrid'],
    );
  }

  @override
  Future<AuthenticateResponseType> authenticate(
    AuthenticateRequestType request,
  ) async {
    authenticated = request;
    final failure = this.failure;
    if (failure != null) {
      throw failure;
    }
    return const AuthenticateResponseType(
      id: 'c2F2ZWQ',
      rawId: 'c2F2ZWQ',
      clientDataJSON: 'Y2xpZW50',
      authenticatorData: 'ZGF0YQ',
      signature: 'c2ln',
      userHandle: 'U2VlZE1NQlJBQUEx',
    );
  }

  @override
  Future<void> cancelCurrentAuthenticatorOperation() async {}

  @override
  Future<AvailabilityType> getAvailability() async {
    final failure = availabilityFailure;
    if (failure != null) {
      throw failure;
    }
    return AvailabilityTypeAndroid(
      hasPasskeySupport: supported,
      isNative: true,
      isUserVerifyingPlatformAuthenticatorAvailable: supported,
    );
  }
}

void main() {
  late _FakePasskeysPlatform platform;
  late PlatformPasskeyAuthenticator authenticator;

  setUp(() {
    platform = _FakePasskeysPlatform();
    authenticator = PlatformPasskeyAuthenticator(platform: platform);
  });

  group('offersPasskeys', () {
    const apps = SignInProviders(
      appleBundleIdentifier: 'com.example.reader',
      androidApplicationId: 'com.example.reader.android',
    );

    test('offers them to the app the tenant names on each platform', () {
      expect(
        offersPasskeys(
          apps,
          platform: TargetPlatform.iOS,
          bundleIdentifier: 'com.example.reader',
        ),
        isTrue,
      );
      expect(
        offersPasskeys(
          apps,
          platform: TargetPlatform.android,
          bundleIdentifier: 'com.example.reader.android',
        ),
        isTrue,
      );
    });

    test('offers none to the dev flavor, which the site does not vouch '
        'for', () {
      expect(
        offersPasskeys(
          apps,
          platform: TargetPlatform.iOS,
          bundleIdentifier: 'com.example.reader.dev',
        ),
        isFalse,
      );
      expect(
        offersPasskeys(
          apps,
          platform: TargetPlatform.android,
          bundleIdentifier: 'com.example.reader.android.dev',
        ),
        isFalse,
      );
    });

    test('offers none where the tenant names no app, and on other '
        'platforms', () {
      expect(
        offersPasskeys(
          SignInProviders.none,
          platform: TargetPlatform.android,
          bundleIdentifier: '',
        ),
        isFalse,
      );
      expect(
        offersPasskeys(
          apps,
          platform: TargetPlatform.linux,
          bundleIdentifier: 'com.example.reader',
        ),
        isFalse,
      );
    });
  });

  group('offered', () {
    setUp(() {
      PackageInfo.setMockInitialValues(
        appName: 'Example Reader',
        packageName: 'com.example.reader',
        version: '1.0.0',
        buildNumber: '1',
        buildSignature: '',
      );
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
    });

    tearDown(() {
      debugDefaultTargetPlatformOverride = null;
    });

    const apps = SignInProviders(androidApplicationId: 'com.example.reader');

    test('asks the device only for the app the tenant names', () async {
      expect(await authenticator.offered(apps), isTrue);
      expect(await authenticator.offered(SignInProviders.none), isFalse);
    });

    test('offers none on a device that cannot make passkeys', () async {
      platform.supported = false;

      expect(await authenticator.offered(apps), isFalse);
    });

    test('offers none, rather than failing, on a device that cannot say '
        'whether it makes passkeys', () async {
      platform.availabilityFailure = PlatformException(code: 'channel-error');

      expect(await authenticator.offered(apps), isFalse);
    });
  });

  group('register', () {
    test("hands the plugin the API's creation options", () async {
      await authenticator.register(_creationOptions);

      final request = platform.registered!;
      expect(request.challenge, 'Y3JlYXRl');
      expect(request.relyingParty.id, 'reader.example.com');
      expect(request.user.id, 'U2VlZE1NQlJBQUEx');
      expect(request.user.displayName, 'Sample Member');
      expect(request.pubKeyCredParams!.map((param) => param.alg), [-7, -257]);
      expect(request.authSelectionType!.residentKey, 'required');
      expect(request.authSelectionType!.userVerification, 'required');
      expect(request.excludeCredentials.map((c) => c.id), ['c2F2ZWQ', 'a2V5']);
      expect(request.excludeCredentials.map((c) => c.transports), [
        isEmpty,
        ['usb'],
      ]);
      expect(request.attestation, 'none');
    });

    test('answers the passkey as PublicKeyCredential.toJSON() writes '
        'it', () async {
      final credential = jsonDecode(
        await authenticator.register(_creationOptions),
      );

      expect(credential, {
        'id': 'bmV3',
        'rawId': 'bmV3',
        'type': 'public-key',
        'response': {
          'clientDataJSON': 'Y2xpZW50',
          'attestationObject': 'YXR0ZXN0',
          'transports': ['internal', 'hybrid'],
        },
        'clientExtensionResults': <String, Object?>{},
      });
    });

    test('reads options it cannot use as a failure', () {
      expect(authenticator.register('[]'), throwsA(isA<PasskeyFailure>()));
      expect(platform.registered, isNull);
    });
  });

  group('authenticate', () {
    test('offers every passkey the reader holds for the site, on this '
        'device or another', () async {
      await authenticator.authenticate(_requestOptions);

      final request = platform.authenticated!;
      expect(request.challenge, 'YXNzZXJ0');
      expect(request.relyingPartyId, 'reader.example.com');
      expect(request.userVerification, 'required');
      expect(request.allowCredentials, isNull);
      expect(request.preferImmediatelyAvailableCredentials, isFalse);
    });

    test('answers the assertion as PublicKeyCredential.toJSON() writes '
        'it', () async {
      final credential = jsonDecode(
        await authenticator.authenticate(_requestOptions),
      );

      expect(credential, {
        'id': 'c2F2ZWQ',
        'rawId': 'c2F2ZWQ',
        'type': 'public-key',
        'response': {
          'clientDataJSON': 'Y2xpZW50',
          'authenticatorData': 'ZGF0YQ',
          'signature': 'c2ln',
          'userHandle': 'U2VlZE1NQlJBQUEx',
        },
        'clientExtensionResults': <String, Object?>{},
      });
    });
  });

  group('a platform refusal', () {
    Future<Object?> refusal(String code) async {
      platform.failure = PlatformException(code: code, message: code);
      try {
        await authenticator.authenticate(_requestOptions);
      } on Exception catch (error) {
        return error;
      }
      return null;
    }

    test('reads a closed or timed-out sheet as cancelled', () async {
      expect(await refusal('cancelled'), isA<PasskeyCancelled>());
      expect(await refusal('android-timeout'), isA<PasskeyCancelled>());
      expect(
        await refusal('ios-security-key-timeout'),
        isA<PasskeyCancelled>(),
      );
    });

    test('reads an excluded passkey as one registered already', () async {
      expect(
        await refusal('exclude-credentials-match'),
        isA<PasskeyAlreadyRegistered>(),
      );
    });

    test('reads anything else as a failure', () async {
      expect(await refusal('domain-not-associated'), isA<PasskeyFailure>());
      expect(await refusal('android-no-credential'), isA<PasskeyFailure>());
    });
  });
}
