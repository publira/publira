import 'package:flutter/widgets.dart';
import 'package:publira/auth/identity_provider.dart';

/// What a provider's own sign-in hands back, ready for
/// `AuthService/LoginWithIdToken` or the confirmation `RequestEmailChange` and
/// `DeleteMe` take.
@immutable
class ProviderCredential {
  const ProviderCredential({
    required this.provider,
    required this.idToken,
    required this.nonce,
    this.authorizationCode = '',
    this.redirectUri = '',
    this.name = '',
  });

  final IdentityProvider provider;
  final String idToken;

  /// The nonce as generated. The token carries it as it is (Google) or as its
  /// SHA-256 in hex (Apple), and the API accepts either.
  final String nonce;

  /// Apple only: the code the server exchanges for the refresh token it
  /// revokes when the link or the account goes away.
  final String authorizationCode;

  /// The `redirect_uri` Apple's web flow was run with, which Apple requires
  /// again to exchange [authorizationCode]. Empty where the sign-in was native.
  final String redirectUri;

  /// The name Apple hands over on the first sign-in only, and empty otherwise.
  final String name;
}

/// Thrown when the reader closed the provider's sheet without signing in.
class ProviderSignInCancelled implements Exception {
  const ProviderSignInCancelled();
}

/// Thrown when the provider's sign-in could not produce a token.
class ProviderSignInFailure implements Exception {
  const ProviderSignInFailure(this.message);

  /// Diagnostic only; never shown to the reader.
  final String message;

  @override
  String toString() => 'ProviderSignInFailure($message)';
}

/// The platform's Apple and Google sign-in.
abstract class ProviderSignIn {
  /// The providers this device offers for the tenant's [providers], in the
  /// order the buttons are shown.
  Future<List<IdentityProvider>> offered(SignInProviders providers);

  /// Runs [provider]'s sign-in with a fresh nonce.
  ///
  /// Throws [ProviderSignInCancelled] or [ProviderSignInFailure].
  Future<ProviderCredential> signIn(
    IdentityProvider provider,
    SignInProviders providers,
  );
}

/// The providers an app with [bundleIdentifier] offers on [platform] for the
/// tenant's [providers], in the order the buttons are shown.
///
/// On iOS, Apple is offered only to the app the tenant's iOS app association
/// names, whose bundle identifier its tokens are accepted for. Google there
/// needs the URL scheme of the client this build registered,
/// [googleIosClientId], and is offered only beside Apple, as the App Store
/// requires.
///
/// Android has no native Sign in with Apple, so the app runs Apple's web flow
/// with the tenant's Services ID, and the storefront hands Apple's answer back
/// to the app the tenant's Android app association names. Apple is offered
/// there to that app, and to its `dev` flavor, which a storefront running in
/// development hands the answer to as well. The app cannot tell how the
/// storefront runs, so a `dev` build offers it against a production one too,
/// which answers it with an error rather than a token. Android signs in to
/// Google with the web client as its server client ID.
List<IdentityProvider> offeredProviders(
  SignInProviders providers, {
  required TargetPlatform platform,
  required String bundleIdentifier,
  required String googleIosClientId,
}) {
  final google = providers.google;
  final iosApple =
      providers.apple &&
      providers.appleBundleIdentifier.isNotEmpty &&
      providers.appleBundleIdentifier == bundleIdentifier;
  final applicationId = providers.androidApplicationId;
  final androidApple =
      providers.apple &&
      providers.appleServicesId.isNotEmpty &&
      applicationId.isNotEmpty &&
      (bundleIdentifier == applicationId ||
          bundleIdentifier == '$applicationId.dev');
  return switch (platform) {
    TargetPlatform.iOS when iosApple => [
      IdentityProvider.apple,
      if (google != null &&
          google.iosClientId.isNotEmpty &&
          google.iosClientId == googleIosClientId)
        IdentityProvider.google,
    ],
    TargetPlatform.android => [
      if (androidApple) IdentityProvider.apple,
      if ((google?.webClientId ?? '').isNotEmpty) IdentityProvider.google,
    ],
    _ => const [],
  };
}

/// Where Apple posts the Android app's web flow back to on the tenant's site
/// at [tenantHost], which hands the answer on to the app as the intent
/// `sign_in_with_apple` waits for. It has to be registered as a Return URL on
/// the Services ID, as the tenant console shows it.
Uri appleAndroidRedirectUri(String tenantHost) =>
    Uri.parse('https://$tenantHost/api/v1/auth/apple/callback/android');

/// The [ProviderSignIn] this run offers, absent in a widget test that does
/// not sign in with a provider.
class ProviderSignInScope extends InheritedWidget {
  const ProviderSignInScope({super.key, this.signIn, required super.child});

  final ProviderSignIn? signIn;

  static ProviderSignIn? maybeOf(BuildContext context) {
    final scope = context
        .dependOnInheritedWidgetOfExactType<ProviderSignInScope>();
    return scope?.signIn;
  }

  @override
  bool updateShouldNotify(ProviderSignInScope oldWidget) =>
      signIn != oldWidget.signIn;
}
