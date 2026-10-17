import 'package:flutter/foundation.dart';
import 'package:publira/api/gen/publira/v1/auth.pb.dart' as pb;

/// A provider a reader signs in with instead of a password, as
/// `publira.v1.IdentityProvider` names it.
enum IdentityProvider {
  apple(pb.IdentityProvider.IDENTITY_PROVIDER_APPLE, 'Apple'),
  google(pb.IdentityProvider.IDENTITY_PROVIDER_GOOGLE, 'Google');

  const IdentityProvider(this.wire, this.displayName);

  /// The value the API names this provider by.
  final pb.IdentityProvider wire;

  /// The provider's own name, which no catalog translates.
  final String displayName;

  /// The provider [wire] names, or `null` for the zero value and for a value
  /// this app does not know, which the message reads as the zero value.
  static IdentityProvider? fromWire(pb.IdentityProvider wire) {
    for (final provider in values) {
      if (provider.wire == wire) {
        return provider;
      }
    }
    return null;
  }
}

/// How the tenant lets a reader sign in with Apple and Google, as `GetTenant`
/// answers it, and the apps it names, which decide where those and its
/// passkeys sign in. A provider the tenant has not enabled, or that is not
/// ready, is absent.
@immutable
class SignInProviders {
  const SignInProviders({
    this.apple = false,
    this.appleBundleIdentifier = '',
    this.appleServicesId = '',
    this.androidApplicationId = '',
    this.google,
  });

  static const none = SignInProviders();

  /// Whether the tenant signs readers in with Apple.
  final bool apple;

  /// The bundle identifier of the tenant's iOS app, as
  /// `GetTenantMobileAppAssociation` names it, which is the only app an Apple
  /// token is accepted from and the only one the site shares its passkeys
  /// with. Empty where the tenant names none.
  final String appleBundleIdentifier;

  /// The Services ID the storefront and the Android app run Apple's web flow
  /// with, empty where only the iOS app signs in with Apple.
  final String appleServicesId;

  /// The application ID of the tenant's Android app, as
  /// `GetTenantMobileAppAssociation` names it, which is the only app the
  /// storefront hands Apple's answer back to and the only one it shares its
  /// passkeys with. Empty where the tenant names none.
  final String androidApplicationId;

  final GoogleSignInClients? google;

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
/// account also has a password and a passkey.
@immutable
class LinkedIdentities {
  const LinkedIdentities({
    required this.identities,
    required this.hasPassword,
    this.hasPasskey = false,
  });

  final List<LinkedIdentity> identities;

  /// False for an account a provider sign-in created, which confirms an email
  /// change and its deletion with a fresh sign-in, sets a password through
  /// the password reset, and keeps one way to sign in.
  final bool hasPassword;

  /// Whether the reader holds a passkey the tenant's site and this app sign
  /// them in with.
  final bool hasPasskey;

  /// Whether [provider] is linked.
  bool links(IdentityProvider provider) =>
      identities.any((identity) => identity.provider == provider);

  /// Whether the API refuses to unlink the one provider left, because the
  /// account has neither a password nor a passkey to sign in with instead.
  bool get keepsLast => !hasPassword && !hasPasskey && identities.length == 1;

  /// Whether the API refuses to remove the one passkey left of [passkeys],
  /// because the account has neither a password nor a linked provider to sign
  /// in with instead.
  bool keepsLastPasskey(int passkeys) =>
      !hasPassword && identities.isEmpty && passkeys == 1;
}
