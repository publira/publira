import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/provider_sign_in.dart';

/// How the signed-in account confirms a step that asks who the reader is:
/// with its password where [providers] is `null`, and otherwise with a fresh
/// sign-in to one of the [linked] providers this device offers.
class AccountConfirmation {
  const AccountConfirmation.password() : providers = null, linked = const [];

  const AccountConfirmation.provider(
    SignInProviders this.providers,
    this.linked,
  );

  /// Reads whether the account has a password and, where it has none, which
  /// of its linked providers [signIn] offers on this device.
  ///
  /// Throws what [AuthController.readLinkedIdentities] and
  /// [AuthController.readSignInProviders] throw.
  static Future<AccountConfirmation> read(
    AuthController auth,
    ProviderSignIn? signIn,
  ) async {
    final identities = await auth.readLinkedIdentities();
    if (identities.hasPassword) {
      return const AccountConfirmation.password();
    }
    final providers = await auth.readSignInProviders();
    final offered = await signIn?.offered(providers) ?? const [];
    return AccountConfirmation.provider(providers, [
      for (final provider in offered)
        if (identities.links(provider)) provider,
    ]);
  }

  final SignInProviders? providers;
  final List<IdentityProvider> linked;
}
