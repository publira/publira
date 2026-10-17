import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/provider_sign_in.dart';

/// How the signed-in account confirms a step that asks who the reader is:
/// with its password where [providers] is `null`, and otherwise with one of
/// its passkeys where [passkey] is true, or with a fresh sign-in to one of
/// the [linked] providers this device offers.
class AccountConfirmation {
  const AccountConfirmation.password()
    : providers = null,
      linked = const [],
      passkey = false;

  const AccountConfirmation.signIn(
    SignInProviders this.providers,
    this.linked, {
    this.passkey = false,
  });

  /// Reads whether the account has a password and, where it has none,
  /// whether [passkeys] confirms with one of its passkeys on this device and
  /// which of its linked providers [signIn] offers here.
  ///
  /// A device that cannot say whether it uses the tenant's passkeys offers
  /// none, which leaves the providers to confirm with.
  ///
  /// Throws what [AuthController.readLinkedIdentities] and
  /// [AuthController.readSignInProviders] throw.
  static Future<AccountConfirmation> read(
    AuthController auth,
    ProviderSignIn? signIn,
    PasskeyAuthenticator? passkeys,
  ) async {
    final identities = await auth.readLinkedIdentities();
    if (identities.hasPassword) {
      return const AccountConfirmation.password();
    }
    final providers = await auth.readSignInProviders();
    final offered = await signIn?.offered(providers) ?? const [];
    var passkey = false;
    if (identities.hasPasskey && passkeys != null) {
      try {
        passkey = await passkeys.offered(providers);
      } on Exception {
        // No passkey; the providers may still confirm.
      }
    }
    return AccountConfirmation.signIn(providers, [
      for (final provider in offered)
        if (identities.links(provider)) provider,
    ], passkey: passkey);
  }

  final SignInProviders? providers;
  final List<IdentityProvider> linked;

  /// Whether the account holds a passkey this device confirms with.
  final bool passkey;
}
