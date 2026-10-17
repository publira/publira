import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:passkeys_platform_interface/passkeys_platform_interface.dart';
import 'package:passkeys_platform_interface/types/types.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/passkey.dart';

/// [PasskeyAuthenticator] through Credential Manager on Android and
/// AuthenticationServices on iOS, by way of the `passkeys_android` and
/// `passkeys_darwin` implementations of [PasskeysPlatform].
class PlatformPasskeyAuthenticator implements PasskeyAuthenticator {
  PlatformPasskeyAuthenticator({this._platform});

  /// The implementation a test stands in for the device's.
  final PasskeysPlatform? _platform;

  /// Read when it is first used, since the implementation registers itself
  /// with the binding the app starts.
  PasskeysPlatform get _passkeys => _platform ?? PasskeysPlatform.instance;

  /// This app's bundle identifier or application ID, read once.
  late final Future<String> _bundleIdentifier = PackageInfo.fromPlatform().then(
    (info) => info.packageName,
  );

  /// A device that cannot say which app it is, or whether it makes passkeys,
  /// offers none.
  @override
  Future<bool> offered(SignInProviders providers) async {
    try {
      return offersPasskeys(
            providers,
            platform: defaultTargetPlatform,
            bundleIdentifier: await _bundleIdentifier,
          ) &&
          (await _passkeys.getAvailability()).hasPasskeySupport;
    } on Object {
      return false;
    }
  }

  @override
  Future<String> register(String creationOptionsJson) async {
    final RegisterRequestType request;
    try {
      request = registerRequestFromOptions(creationOptionsJson);
    } on Object catch (error) {
      throw PasskeyFailure('unreadable creation options: $error');
    }
    try {
      return jsonEncode((await _passkeys.register(request)).toJson());
    } on PlatformException catch (error) {
      throw passkeyErrorFrom(error);
    }
  }

  @override
  Future<String> authenticate(String requestOptionsJson) async {
    final AuthenticateRequestType request;
    try {
      request = authenticateRequestFromOptions(requestOptionsJson);
    } on Object catch (error) {
      throw PasskeyFailure('unreadable request options: $error');
    }
    try {
      return jsonEncode((await _passkeys.authenticate(request)).toJson());
    } on PlatformException catch (error) {
      throw passkeyErrorFrom(error);
    }
  }
}

/// The registration the plugin makes from the creation options the API
/// answers with.
///
/// The plugin reads every credential it is told to exclude as carrying a list
/// of transports, which the WebAuthn JSON leaves out for a credential that
/// reported none, so an absent one is read as empty.
@visibleForTesting
RegisterRequestType registerRequestFromOptions(String creationOptionsJson) {
  final options = _object(jsonDecode(creationOptionsJson));
  return RegisterRequestType.fromJson({
    ...options,
    'excludeCredentials': _descriptors(options['excludeCredentials']),
  });
}

/// The assertion the plugin asks for from the request options the API
/// answers with.
///
/// The system sheet is the one a reader asked for by pressing a button, so it
/// offers a passkey from another device or a security key as well as the
/// ones on this device, rather than failing where this device holds none.
@visibleForTesting
AuthenticateRequestType authenticateRequestFromOptions(
  String requestOptionsJson,
) {
  final options = _object(jsonDecode(requestOptionsJson));
  return AuthenticateRequestType.fromJson({
    ...options,
    'allowCredentials': _descriptors(options['allowCredentials']),
  }, preferImmediatelyAvailableCredentials: false);
}

Map<String, dynamic> _object(Object? json) {
  if (json is! Map<String, dynamic>) {
    throw const FormatException('expected a JSON object');
  }
  return json;
}

List<Map<String, dynamic>> _descriptors(Object? json) => [
  if (json is List)
    for (final descriptor in json.whereType<Map<String, dynamic>>())
      {'transports': const <String>[], ...descriptor},
];

/// What a [PlatformException] from either implementation means for the
/// reader.
///
/// Both report a closed sheet as `cancelled`. Android reports a sheet that
/// timed out apart from it, and iOS a security key's prompt that timed out,
/// which the reader is told about in the same words, as a browser tells the
/// two apart no better.
@visibleForTesting
Exception passkeyErrorFrom(PlatformException error) => switch (error.code) {
  'cancelled' ||
  'android-timeout' ||
  'ios-security-key-timeout' => const PasskeyCancelled(),
  'exclude-credentials-match' => const PasskeyAlreadyRegistered(),
  _ => PasskeyFailure('${error.code}: ${error.message}'),
};
