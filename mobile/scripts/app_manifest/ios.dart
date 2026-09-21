// The iOS build configuration generated from an app manifest, which
// `ios/Flutter/Debug.xcconfig` and `ios/Flutter/Release.xcconfig` include.

import 'manifest.dart';

/// The file Xcode reads the app's identity from.
const iosAppXcconfig = 'App.xcconfig';

/// The files an iOS build reads, keyed by name, for [manifest] read from
/// [source].
Map<String, String> iosGeneratedFiles(
  AppManifest manifest, {
  required String source,
}) => {
  iosAppXcconfig: [
    '// Generated from $source by scripts/app_manifest.dart. Do not edit;',
    '// change the manifest and generate again.',
    'PUBLIRA_BUNDLE_IDENTIFIER = ${manifest.iosBundleIdentifier}',
    'PUBLIRA_ASSOCIATED_DOMAIN = ${manifest.tenantHost}',
    'PUBLIRA_APP_NAME = ${xcconfigValue(manifest.appName)}',
    '',
  ].join('\n'),
};

/// [value] as Xcode reads it back from an xcconfig line. `//` would start a
/// comment, `$` a reference, and a trailing `;` would be dropped, so each `/`
/// and `;` is followed by an empty reference and `$` is written as the
/// built-in `$(DOLLAR)`.
String xcconfigValue(String value) => value.replaceAllMapped(
  RegExp(r'[$/;]'),
  (m) => m[0] == r'$' ? r'$(DOLLAR)' : '${m[0]}\$()',
);
