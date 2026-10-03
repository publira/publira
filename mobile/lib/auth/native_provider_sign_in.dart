import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

/// [ProviderSignIn] through Sign in with Apple and Google Sign-In.
class NativeProviderSignIn implements ProviderSignIn {
  NativeProviderSignIn({
    required this.googleIosClientId,
    required this.tenantHost,
  });

  /// The iOS client whose URL scheme this build registered, empty for a build
  /// that registered none.
  final String googleIosClientId;

  /// The tenant's site, which Apple's web flow on Android returns through.
  final String tenantHost;

  /// This app's bundle identifier or application ID, read once.
  late final Future<String> _bundleIdentifier = PackageInfo.fromPlatform().then(
    (info) => info.packageName,
  );

  @override
  Future<List<IdentityProvider>> offered(SignInProviders providers) async =>
      offeredProviders(
        providers,
        platform: defaultTargetPlatform,
        bundleIdentifier: await _bundleIdentifier,
        googleIosClientId: googleIosClientId,
      );

  @override
  Future<ProviderCredential> signIn(
    IdentityProvider provider,
    SignInProviders providers,
  ) {
    final nonce = _newNonce();
    return switch (provider) {
      IdentityProvider.apple => _signInWithApple(nonce, providers),
      IdentityProvider.google => _signInWithGoogle(nonce, providers),
    };
  }

  /// Native on iOS. On Android it is Apple's web flow in a Custom Tab, with
  /// the tenant's Services ID, returning through the storefront; `state`
  /// names this app, which is how the storefront knows the `dev` flavor from
  /// the store build.
  Future<ProviderCredential> _signInWithApple(
    String nonce,
    SignInProviders providers,
  ) async {
    final redirectUri = defaultTargetPlatform == TargetPlatform.android
        ? appleAndroidRedirectUri(tenantHost)
        : null;
    final AuthorizationCredentialAppleID credential;
    try {
      credential = await SignInWithApple.getAppleIDCredential(
        scopes: const [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
        nonce: sha256.convert(utf8.encode(nonce)).toString(),
        webAuthenticationOptions: redirectUri == null
            ? null
            : WebAuthenticationOptions(
                clientId: providers.appleServicesId,
                redirectUri: redirectUri,
              ),
        state: redirectUri == null ? null : await _bundleIdentifier,
      );
    } on SignInWithAppleAuthorizationException catch (error) {
      if (error.code == AuthorizationErrorCode.canceled) {
        throw const ProviderSignInCancelled();
      }
      throw ProviderSignInFailure(error.message);
    } on SignInWithAppleException catch (error) {
      throw ProviderSignInFailure('$error');
    }
    final idToken = credential.identityToken ?? '';
    if (idToken.isEmpty) {
      throw const ProviderSignInFailure('Apple returned no identity token');
    }
    return ProviderCredential(
      provider: IdentityProvider.apple,
      idToken: idToken,
      nonce: nonce,
      authorizationCode: credential.authorizationCode,
      redirectUri: redirectUri?.toString() ?? '',
      name: [credential.givenName, credential.familyName]
          .map((part) => part?.trim() ?? '')
          .where((part) => part.isNotEmpty)
          .join(' '),
    );
  }

  /// Configured anew for every sign-in, because the nonce is part of the
  /// configuration and the API accepts each one once.
  Future<ProviderCredential> _signInWithGoogle(
    String nonce,
    SignInProviders providers,
  ) async {
    final google = GoogleSignInPlatform.instance;
    final clients = providers.google;
    final AuthenticationResults results;
    try {
      await google.init(
        InitParameters(
          clientId: defaultTargetPlatform == TargetPlatform.iOS
              ? clients?.iosClientId
              : null,
          serverClientId: defaultTargetPlatform == TargetPlatform.android
              ? clients?.webClientId
              : null,
          nonce: nonce,
        ),
      );
      results = await google.authenticate(const AuthenticateParameters());
    } on GoogleSignInException catch (error) {
      if (error.code == GoogleSignInExceptionCode.canceled) {
        throw const ProviderSignInCancelled();
      }
      throw ProviderSignInFailure('${error.code}: ${error.description}');
    } on PlatformException catch (error) {
      // What the iOS SDK raises for a URL scheme the build did not register.
      throw ProviderSignInFailure('${error.code}: ${error.message}');
    }
    // The app keeps a session of its own, so Google's is not kept beside it.
    try {
      await google.signOut(const SignOutParams());
    } on Object {
      // Nothing depends on it.
    }
    final idToken = results.authenticationTokens.idToken ?? '';
    if (idToken.isEmpty) {
      throw const ProviderSignInFailure('Google returned no ID token');
    }
    return ProviderCredential(
      provider: IdentityProvider.google,
      idToken: idToken,
      nonce: nonce,
    );
  }

  static String _newNonce() {
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }
}
