import 'package:flutter/widgets.dart';
import 'package:publira/auth/identity_provider.dart';

/// What a provider's own sign-in hands back, ready for
/// `AuthService/LoginWithIdToken` or the confirmation `DeleteMe` takes.
@immutable
class ProviderCredential {
  const ProviderCredential({
    required this.provider,
    required this.idToken,
    required this.nonce,
    this.authorizationCode = '',
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
  List<IdentityProvider> offered(SignInProviders providers);

  /// Runs [provider]'s sign-in with a fresh nonce.
  ///
  /// Throws [ProviderSignInCancelled] or [ProviderSignInFailure].
  Future<ProviderCredential> signIn(
    IdentityProvider provider,
    SignInProviders providers,
  );
}

/// The providers a build for [platform] offers for [providers], in the order
/// the buttons are shown.
///
/// Apple is offered on iOS alone: elsewhere it is a web flow that needs a
/// redirect back into the app (#3390). Google on iOS needs the URL scheme of
/// the client this build registered, [googleIosClientId], and is offered only
/// beside Apple, as the App Store requires. Android signs in to Google with
/// the web client as its server client ID.
List<IdentityProvider> offeredProviders(
  SignInProviders providers, {
  required TargetPlatform platform,
  required String googleIosClientId,
}) {
  final google = providers.google;
  return switch (platform) {
    TargetPlatform.iOS when providers.apple => [
      IdentityProvider.apple,
      if (google != null &&
          google.iosClientId.isNotEmpty &&
          google.iosClientId == googleIosClientId)
        IdentityProvider.google,
    ],
    TargetPlatform.android when (google?.webClientId ?? '').isNotEmpty => [
      IdentityProvider.google,
    ],
    _ => const [],
  };
}

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
