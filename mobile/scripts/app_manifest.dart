// Checks an app manifest, reporting every problem in it at once, and with
// `--generate` writes the build configuration the platform builds read.
//
//   dart run scripts/app_manifest.dart [--generate] [<manifest>]
//
// Without a manifest it reads config/app.default.yaml, Publira's own. The
// configuration goes into $PUBLIRA_MOBILE_GENERATED_DIR, else .generated/.

import 'dart:io';

import 'app_manifest/generate.dart';
import 'app_manifest/generated_files.dart';
import 'app_manifest/manifest.dart';

Future<void> main(List<String> arguments) async {
  final generate = arguments.contains('--generate');
  final paths = arguments.where((a) => a != '--generate').toList();
  if (paths.length > 1 || paths.any((a) => a.startsWith('-'))) {
    stderr.writeln(
      'usage: dart run scripts/app_manifest.dart [--generate] [<manifest>]',
    );
    exit(2);
  }
  final mobileDirectory = File.fromUri(Platform.script).parent.parent;
  final file = paths.isEmpty
      ? File.fromUri(mobileDirectory.uri.resolve('config/app.default.yaml'))
      : File(paths.single);

  final directory = generatedDirectory(mobileDirectory, Platform.environment);
  final AppManifest manifest;
  try {
    manifest = generate
        ? await generateBuildConfiguration(file, directory)
        : await AppManifest.load(file);
  } on AppManifestException catch (error) {
    stderr.writeln(error);
    exit(1);
  }
  stdout.writeln(
    '${file.path}: ${manifest.appName} for ${manifest.tenantHost} '
    '(Android ${manifest.androidApplicationId}, '
    'iOS ${manifest.iosBundleIdentifier})',
  );
  if (generate) {
    stdout.writeln('generated the build configuration in ${directory.path}');
  }
}
