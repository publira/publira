import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/native_provider_sign_in.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:sign_in_with_apple_platform_interface/sign_in_with_apple_platform_interface.dart';

/// Stands in for Sign in with Apple. On Android it answers as the plugin
/// does once the storefront has redirected Apple's form post to the
/// `intent://callback` the callback activity receives; elsewhere it answers
/// as the native sheet does.
class _FakeSignInWithApple extends SignInWithApplePlatform {
  /// The fields Apple posts, which the storefront forwards as the intent's
  /// query. `state` is echoed from the request.
  Map<String, String> answer = const {
    'code': 'apple-code',
    'id_token': 'apple-id-token',
    'user': '{"name":{"firstName":"Taylor","lastName":"Reader"}}',
  };

  WebAuthenticationOptions? webAuthenticationOptions;
  String? nonce;
  String? state;

  @override
  Future<AuthorizationCredentialAppleID> getAppleIDCredential({
    required List<AppleIDAuthorizationScopes> scopes,
    WebAuthenticationOptions? webAuthenticationOptions,
    String? nonce,
    String? state,
  }) async {
    this.webAuthenticationOptions = webAuthenticationOptions;
    this.nonce = nonce;
    this.state = state;
    if (webAuthenticationOptions == null) {
      return const AuthorizationCredentialAppleID(
        userIdentifier: 'apple-user',
        givenName: null,
        familyName: null,
        email: null,
        authorizationCode: 'native-code',
        identityToken: 'native-id-token',
        state: null,
      );
    }
    return parseAuthorizationCredentialAppleIDFromDeeplink(
      Uri(
        scheme: 'signinwithapple',
        host: 'callback',
        queryParameters: {...answer, 'state': ?state},
      ),
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const tenantHost = 'reader.example.com';
  const providers = SignInProviders(
    apple: true,
    appleServicesId: 'com.example.reader.web',
    androidApplicationId: 'com.example.reader',
  );

  late _FakeSignInWithApple apple;

  void runAs(String packageName) => PackageInfo.setMockInitialValues(
    appName: 'Reader',
    packageName: packageName,
    version: '1.0.0',
    buildNumber: '1',
    buildSignature: '',
  );

  NativeProviderSignIn newSignIn() =>
      NativeProviderSignIn(googleIosClientId: '', tenantHost: tenantHost);

  setUp(() {
    apple = _FakeSignInWithApple();
    SignInWithApplePlatform.instance = apple;
  });

  tearDown(() => debugDefaultTargetPlatformOverride = null);

  group('on Android', () {
    setUp(() {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      runAs('com.example.reader');
    });

    test('offers Apple to the app the tenant names', () async {
      expect(await newSignIn().offered(providers), [IdentityProvider.apple]);
    });

    test('runs Apple\'s web flow with the Services ID, returning through the '
        'storefront to this app', () async {
      final credential = await newSignIn().signIn(
        IdentityProvider.apple,
        providers,
      );

      expect(
        apple.webAuthenticationOptions?.clientId,
        'com.example.reader.web',
      );
      expect(
        apple.webAuthenticationOptions?.redirectUri,
        Uri.parse(
          'https://reader.example.com/api/v1/auth/apple/callback/android',
        ),
      );
      expect(apple.state, 'com.example.reader');
      expect(
        apple.nonce,
        sha256.convert(utf8.encode(credential.nonce)).toString(),
      );

      expect(credential.provider, IdentityProvider.apple);
      expect(credential.idToken, 'apple-id-token');
      expect(credential.authorizationCode, 'apple-code');
      expect(
        credential.redirectUri,
        'https://reader.example.com/api/v1/auth/apple/callback/android',
      );
      expect(credential.name, 'Taylor Reader');
    });

    test('names the dev flavor in the state, for a storefront in '
        'development', () async {
      runAs('com.example.reader.dev');

      final signIn = newSignIn();
      expect(await signIn.offered(providers), [IdentityProvider.apple]);
      await signIn.signIn(IdentityProvider.apple, providers);

      expect(apple.state, 'com.example.reader.dev');
    });

    test('a reader stopping on Apple\'s page is cancelled', () async {
      apple.answer = const {'error': 'user_cancelled_authorize'};

      await expectLater(
        newSignIn().signIn(IdentityProvider.apple, providers),
        throwsA(isA<ProviderSignInCancelled>()),
      );
    });

    test('a production storefront refusing the dev flavor is a failure, not '
        'a cancellation', () async {
      runAs('com.example.reader.dev');
      apple.answer = const {'error': 'dev_build_refused'};

      await expectLater(
        newSignIn().signIn(IdentityProvider.apple, providers),
        throwsA(isA<ProviderSignInFailure>()),
      );
    });

    test('an answer without a token is a failure', () async {
      apple.answer = const {'code': 'apple-code'};

      await expectLater(
        newSignIn().signIn(IdentityProvider.apple, providers),
        throwsA(isA<ProviderSignInFailure>()),
      );
    });
  });

  test('iOS signs in natively, with no redirect to send', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    runAs('com.example.reader');

    final credential = await newSignIn().signIn(
      IdentityProvider.apple,
      providers,
    );

    expect(apple.webAuthenticationOptions, isNull);
    expect(apple.state, isNull);
    expect(credential.idToken, 'native-id-token');
    expect(credential.authorizationCode, 'native-code');
    expect(credential.redirectUri, isEmpty);
  });
}
