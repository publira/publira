// Checks an app manifest, reporting every problem in it at once.
//
//   dart run scripts/app_manifest.dart [<manifest>]
//
// Without an argument it checks config/app.default.yaml, Publira's own.

import 'dart:io';

import 'app_manifest/manifest.dart';

Future<void> main(List<String> arguments) async {
  if (arguments.length > 1 || arguments.any((a) => a.startsWith('-'))) {
    stderr.writeln('usage: dart run scripts/app_manifest.dart [<manifest>]');
    exit(2);
  }
  final file = arguments.isEmpty
      ? File.fromUri(Platform.script.resolve('../config/app.default.yaml'))
      : File(arguments.single);

  try {
    final manifest = await AppManifest.load(file);
    stdout.writeln(
      '${file.path}: ${manifest.appName} for ${manifest.tenantHost} '
      '(Android ${manifest.androidApplicationId}, '
      'iOS ${manifest.iosBundleIdentifier})',
    );
  } on AppManifestException catch (error) {
    stderr.writeln(error);
    exit(1);
  }
}
