import 'package:flutter/widgets.dart';
import 'package:publira/auth/identity_provider.dart';

/// A passkey the reader signs in to the tenant's site and this app with, as
/// `publira.v1.Passkey` describes it.
@immutable
class Passkey {
  const Passkey({
    required this.id,
    required this.name,
    this.createdAt,
    this.lastUsedAt,
    this.backedUp = false,
  });

  final String id;

  /// What its owner called it, empty until they name it.
  final String name;

  final DateTime? createdAt;

  /// `null` until it first signs the reader in or confirms a step.
  final DateTime? lastUsedAt;

  /// Whether the authenticator syncs it to the owner's other devices, as
  /// iCloud Keychain and Google Password Manager do.
  final bool backedUp;
}

/// Thrown when the reader closed the system's passkey sheet, or let it time
/// out, without choosing a passkey.
class PasskeyCancelled implements Exception {
  const PasskeyCancelled();
}

/// Thrown when the authenticator already holds one of the reader's passkeys
/// for the site, which the registration excluded.
class PasskeyAlreadyRegistered implements Exception {
  const PasskeyAlreadyRegistered();
}

/// Thrown when the device could not make or use a passkey for the options it
/// was given.
class PasskeyFailure implements Exception {
  const PasskeyFailure(this.message);

  /// Diagnostic only; never shown to the reader.
  final String message;

  @override
  String toString() => 'PasskeyFailure($message)';
}

/// The device's own passkey authenticator, which makes and uses the passkeys
/// bound to the tenant's site.
///
/// The options and the credentials are the JSON the public API speaks:
/// `PublicKeyCredentialCreationOptionsJSON` and
/// `PublicKeyCredentialRequestOptionsJSON` in, and the `PublicKeyCredential`
/// as its `toJSON()` serializes it out.
abstract class PasskeyAuthenticator {
  /// Whether this device makes and uses passkeys for the tenant whose apps
  /// [providers] names.
  Future<bool> offered(SignInProviders providers);

  /// Asks the reader for a new passkey made over [creationOptionsJson].
  ///
  /// Throws [PasskeyCancelled], [PasskeyAlreadyRegistered], or
  /// [PasskeyFailure].
  Future<String> register(String creationOptionsJson);

  /// Asks the reader for one of their passkeys to sign [requestOptionsJson]'s
  /// challenge with.
  ///
  /// Throws [PasskeyCancelled] or [PasskeyFailure].
  Future<String> authenticate(String requestOptionsJson);
}

/// Whether an app with [bundleIdentifier] on [platform] makes and uses the
/// passkeys of the tenant's site, given that the device itself can make
/// passkeys at all.
///
/// The operating system offers a passkey bound to the site only to an app the
/// site vouches for, and the site vouches for the apps the tenant names under
/// **App links** and no other: its `apple-app-site-association` lists the iOS
/// app under `webcredentials`, and its `assetlinks.json` grants the Android
/// app `get_login_creds`. A build of any other identity, the `dev` flavor
/// among them, would show a sheet that can only fail.
bool offersPasskeys(
  SignInProviders providers, {
  required TargetPlatform platform,
  required String bundleIdentifier,
}) {
  final tenantApp = switch (platform) {
    TargetPlatform.iOS => providers.appleBundleIdentifier,
    TargetPlatform.android => providers.androidApplicationId,
    _ => '',
  };
  return tenantApp.isNotEmpty && tenantApp == bundleIdentifier;
}

/// The [PasskeyAuthenticator] this run offers, absent on a platform without
/// one and in a widget test that does not use passkeys.
class PasskeyAuthenticatorScope extends InheritedWidget {
  const PasskeyAuthenticatorScope({
    super.key,
    this.authenticator,
    required super.child,
  });

  final PasskeyAuthenticator? authenticator;

  static PasskeyAuthenticator? maybeOf(BuildContext context) {
    final scope = context
        .dependOnInheritedWidgetOfExactType<PasskeyAuthenticatorScope>();
    return scope?.authenticator;
  }

  @override
  bool updateShouldNotify(PasskeyAuthenticatorScope oldWidget) =>
      authenticator != oldWidget.authenticator;
}
