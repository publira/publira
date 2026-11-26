import 'package:publira/auth/provider_sign_in.dart';

/// What adding a passkey, removing one, or unlinking a provider is confirmed
/// with on top of the session, as `AuthService/DeleteMe` is: the account's
/// password, a fresh sign-in to a provider linked to it, or an assertion one
/// of its passkeys made over a challenge `BeginPasskeyConfirmation` issued.
///
/// The API asks for one because each of the three steps changes how the
/// account is signed in to, and a session alone may be one left open on a
/// device somebody else now holds.
sealed class StepConfirmation {
  const StepConfirmation();
}

/// The account's current password.
final class ConfirmedByPassword extends StepConfirmation {
  const ConfirmedByPassword(this.password);

  final String password;
}

/// A fresh sign-in to a provider linked to the account.
final class ConfirmedBySignIn extends StepConfirmation {
  const ConfirmedBySignIn(this.credential);

  final ProviderCredential credential;
}

/// The assertion, as the authenticator serialized it, that one of the
/// account's passkeys made.
final class ConfirmedByPasskey extends StepConfirmation {
  const ConfirmedByPasskey(this.credentialJson);

  final String credentialJson;
}
