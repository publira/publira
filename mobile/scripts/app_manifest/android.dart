// The Android build configuration generated from an app manifest, which
// `android/app/build.gradle.kts` reads.

import 'manifest.dart';

/// The file Gradle reads the app's identity from.
const androidAppProperties = 'app.properties';

/// The files an Android build reads, keyed by name, for [manifest] read from
/// [source].
Map<String, String> androidGeneratedFiles(
  AppManifest manifest, {
  required String source,
}) => {
  androidAppProperties: [
    '# Generated from $source by scripts/app_manifest.dart. Do not edit;',
    '# change the manifest and generate again.',
    'publira.applicationId=${_escape(manifest.androidApplicationId)}',
    'publira.tenantHost=${_escape(manifest.tenantHost)}',
    'publira.appName=${_escape(manifest.appName)}',
    '',
  ].join('\n'),
};

/// A value as `java.util.Properties` reads it back. Gradle reads the file as
/// UTF-8, and a validated manifest has no line breaks and no whitespace at
/// either end of a value, so a backslash is all that needs escaping.
String _escape(String value) => value.replaceAll(r'\', r'\\');
