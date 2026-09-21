// The iOS build configuration generated from an app manifest, which
// `ios/Flutter/Debug.xcconfig` and `ios/Flutter/Release.xcconfig` include.

import 'generated_files.dart';
import 'manifest.dart';

/// The file Xcode reads the app's identity from.
const iosAppXcconfig = 'App.xcconfig';

/// A setting that expands to nothing, which [xcconfigValue] places where the
/// literal characters would otherwise be read as xcconfig syntax.
const _empty = 'PUBLIRA_EMPTY';

/// The files an iOS build reads, keyed by name, for [manifest] read from
/// [source].
Map<String, String> iosGeneratedFiles(
  AppManifest manifest, {
  required String source,
}) => {
  iosAppXcconfig: [
    '// Generated from ${commentText(source)} by scripts/app_manifest.dart. '
        'Do not edit;',
    '// change the manifest and generate again.',
    '$_empty =',
    'PUBLIRA_BUNDLE_IDENTIFIER = ${manifest.iosBundleIdentifier}',
    'PUBLIRA_ASSOCIATED_DOMAIN = ${manifest.tenantHost}',
    'PUBLIRA_APP_NAME = ${xcconfigValue(manifest.appName)}',
    '',
  ].join('\n'),
};

/// [value] as Xcode evaluates it back from an xcconfig line as a string.
///
/// `//` starts a comment and a trailing `;` is dropped, so each `/` and `;` is
/// followed by an empty reference. An unescaped `$` starts a reference and is
/// doubled; one a backslash escapes is already literal. The manifest refuses a
/// trailing backslash, which would continue the line.
String xcconfigValue(String value) {
  final buffer = StringBuffer();
  var escaped = false;
  for (final c in value.split('')) {
    buffer.write(c == r'$' && !escaped ? r'$$' : c);
    if (c == '/' || c == ';') {
      buffer.write('\$($_empty)');
    }
    escaped = c == r'\' && !escaped;
  }
  return buffer.toString();
}
