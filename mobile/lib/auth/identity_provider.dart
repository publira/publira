import 'package:flutter/foundation.dart';

/// A provider a reader signs in with instead of a password, as
/// `publira.v1.IdentityProvider` names it.
enum IdentityProvider {
  apple('IDENTITY_PROVIDER_APPLE', 'Apple'),
  google('IDENTITY_PROVIDER_GOOGLE', 'Google');

  const IdentityProvider(this.wireName, this.displayName);

  /// The enum value's name, which protojson sends and reads.
  final String wireName;

  /// The provider's own name, which no catalog translates.
  final String displayName;

  /// The provider [raw] names, or `null` for a value this app does not know.
  static IdentityProvider? fromWire(Object? raw) {
    for (final provider in values) {
      if (provider.wireName == raw) {
        return provider;
      }
    }
    return null;
  }
}

/// How the tenant lets a reader sign in with Apple and Google, as `GetTenant`
/// answers it. A provider the tenant has not enabled, or that is not ready,
/// is absent.
@immutable
class SignInProviders {
  const SignInProviders({
    this.apple = false,
    this.appleBundleIdentifier = '',
    this.google,
  });

  /// Read from the `GetTenant` body [tenant], with the iOS bundle identifier
  /// [appleBundleIdentifier] Apple's tokens are accepted for.
  factory SignInProviders.fromTenant(
    Map<String, Object?> tenant, {
    String appleBundleIdentifier = '',
  }) {
    final google = tenant['googleSignIn'];
    return SignInProviders(
      // protojson sends an enabled provider with no field set as `{}`.
      apple: tenant['appleSignIn'] is Map,
      appleBundleIdentifier: appleBundleIdentifier,
      google: google is Map
          ? GoogleSignInClients(
              webClientId: _trimmed(google['webClientId']),
              iosClientId: _trimmed(google['iosClientId']),
            )
          : null,
    );
  }

  static const none = SignInProviders();

  /// Whether the tenant signs readers in with Apple. The iOS app signs in
  /// with its own bundle identifier, so no client ID comes with it.
  final bool apple;

  /// The bundle identifier of the tenant's iOS app, as
  /// `GetTenantMobileAppAssociation` names it, which is the only app an Apple
  /// token is accepted from. Empty where the tenant names none.
  final String appleBundleIdentifier;

  final GoogleSignInClients? google;

  static String _trimmed(Object? value) => value is String ? value.trim() : '';

  @override
  bool operator ==(Object other) =>
      other is SignInProviders &&
      other.apple == apple &&
      other.appleBundleIdentifier == appleBundleIdentifier &&
      other.google == google;

  @override
  int get hashCode => Object.hash(apple, appleBundleIdentifier, google);
}

/// The Google OAuth clients the tenant signs readers in through. Each is
/// empty where the tenant has no client of that kind.
@immutable
class GoogleSignInClients {
  const GoogleSignInClients({this.webClientId = '', this.iosClientId = ''});

  /// The Android app's server client ID, which the ID token is issued to.
  final String webClientId;

  /// The iOS app's own client.
  final String iosClientId;

  @override
  bool operator ==(Object other) =>
      other is GoogleSignInClients &&
      other.webClientId == webClientId &&
      other.iosClientId == iosClientId;

  @override
  int get hashCode => Object.hash(webClientId, iosClientId);
}

/// A provider account linked to the signed-in reader.
@immutable
class LinkedIdentity {
  const LinkedIdentity({
    required this.provider,
    required this.email,
    this.linkedAt,
  });

  final IdentityProvider provider;

  /// The address the provider's token carried when the account was linked.
  final String email;
  final DateTime? linkedAt;
}

/// The provider accounts linked to the signed-in reader, and whether the
/// account also has a password.
@immutable
class LinkedIdentities {
  const LinkedIdentities({required this.identities, required this.hasPassword});

  final List<LinkedIdentity> identities;

  /// False for an account a provider sign-in created, which confirms its
  /// deletion with a fresh sign-in and keeps its last linked provider.
  final bool hasPassword;

  /// Whether [provider] is linked.
  bool links(IdentityProvider provider) =>
      identities.any((identity) => identity.provider == provider);

  /// Whether the API refuses to unlink the one provider left, because the
  /// account has no password to sign in with instead.
  bool get keepsLast => !hasPassword && identities.length == 1;
}
