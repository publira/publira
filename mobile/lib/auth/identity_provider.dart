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
    this.appleServicesId = '',
    this.androidApplicationId = '',
    this.google,
  });

  /// Read from the `GetTenant` body [tenant], with the apps
  /// `GetTenantMobileAppAssociation` names: the iOS bundle identifier
  /// [appleBundleIdentifier] Apple's tokens are accepted for, and the Android
  /// [androidApplicationId] the storefront hands Apple's answer back to.
  factory SignInProviders.fromTenant(
    Map<String, Object?> tenant, {
    String appleBundleIdentifier = '',
    String androidApplicationId = '',
  }) {
    final apple = tenant['appleSignIn'];
    final google = tenant['googleSignIn'];
    return SignInProviders(
      // protojson sends an enabled provider with no field set as `{}`.
      apple: apple is Map,
      appleBundleIdentifier: appleBundleIdentifier,
      appleServicesId: apple is Map ? _trimmed(apple['servicesId']) : '',
      androidApplicationId: androidApplicationId,
      google: google is Map
          ? GoogleSignInClients(
              webClientId: _trimmed(google['webClientId']),
              iosClientId: _trimmed(google['iosClientId']),
            )
          : null,
    );
  }

  static const none = SignInProviders();

  /// Whether the tenant signs readers in with Apple.
  final bool apple;

  /// The bundle identifier of the tenant's iOS app, as
  /// `GetTenantMobileAppAssociation` names it, which is the only app an Apple
  /// token is accepted from. Empty where the tenant names none.
  final String appleBundleIdentifier;

  /// The Services ID the storefront and the Android app run Apple's web flow
  /// with, empty where only the iOS app signs in with Apple.
  final String appleServicesId;

  /// The application ID of the tenant's Android app, as
  /// `GetTenantMobileAppAssociation` names it, which is the only app the
  /// storefront hands Apple's answer back to. Empty where the tenant names
  /// none.
  final String androidApplicationId;

  final GoogleSignInClients? google;

  static String _trimmed(Object? value) => value is String ? value.trim() : '';

  @override
  bool operator ==(Object other) =>
      other is SignInProviders &&
      other.apple == apple &&
      other.appleBundleIdentifier == appleBundleIdentifier &&
      other.appleServicesId == appleServicesId &&
      other.androidApplicationId == androidApplicationId &&
      other.google == google;

  @override
  int get hashCode => Object.hash(
    apple,
    appleBundleIdentifier,
    appleServicesId,
    androidApplicationId,
    google,
  );
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

  /// False for an account a provider sign-in created, which confirms an email
  /// change and its deletion with a fresh sign-in, sets a password through
  /// the password reset, and keeps its last linked provider.
  final bool hasPassword;

  /// Whether [provider] is linked.
  bool links(IdentityProvider provider) =>
      identities.any((identity) => identity.provider == provider);

  /// Whether the API refuses to unlink the one provider left, because the
  /// account has no password to sign in with instead.
  bool get keepsLast => !hasPassword && identities.length == 1;
}
