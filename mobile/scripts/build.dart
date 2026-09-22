// Builds the app a tenant publishes: checks the app manifest, generates the
// build configuration from it, and runs `flutter build` with the tenant host
// the manifest names.
//
//   dart run scripts/build.dart <manifest> <apk|appbundle|ios|ipa> [flutter build arguments]
//
// The flavor is production unless the arguments name another. A production
// build reads the origin it connects to from $PUBLIRA_BASE_URL. The build
// fails when it changed the working tree.

import 'dart:io';

import 'app_manifest/flutter_build.dart';
import 'app_manifest/generate.dart';
import 'app_manifest/generated_files.dart';
import 'app_manifest/manifest.dart';
import 'app_manifest/working_tree.dart';

Future<void> main(List<String> arguments) async {
  final BuildRequest request;
  try {
    request = BuildRequest.parse(arguments);
  } on BuildException catch (error) {
    stderr.writeln(error);
    exit(2);
  }
  final mobileDirectory = File.fromUri(Platform.script).parent.parent;
  final manifestFile = File(request.manifestPath);
  final directory = generatedDirectory(mobileDirectory, Platform.environment);

  final List<String> flutterArguments;
  try {
    final manifest = await AppManifest.load(manifestFile);
    if (xcodeBuildTargets.contains(request.target) &&
        directory.absolute.path !=
            defaultGeneratedDirectory(mobileDirectory).absolute.path) {
      throw BuildException([
        'Xcode reads the build configuration from .generated/ only; unset '
            '$generatedDirectoryVariable for an ${request.target} build',
      ]);
    }
    flutterArguments = flutterBuildArguments(
      request,
      manifest,
      Platform.environment,
    );
  } on AppManifestException catch (error) {
    stderr.writeln(error);
    exit(1);
  } on BuildException catch (error) {
    stderr.writeln(error);
    exit(1);
  }

  final before = await WorkingTreeSnapshot.take(mobileDirectory);
  await generateBuildConfiguration(manifestFile, directory);
  stdout.writeln('flutter ${flutterArguments.join(' ')}');
  final flutter = await Process.start(
    'flutter',
    flutterArguments,
    workingDirectory: mobileDirectory.path,
    mode: ProcessStartMode.inheritStdio,
  );
  final code = await flutter.exitCode;
  if (code != 0) {
    exit(code);
  }

  // Tenant identity lives in ignored, generated files only; a build that
  // leaves a change to a tracked file behind would be committed by whoever
  // builds next.
  final after = await WorkingTreeSnapshot.take(mobileDirectory);
  if (before == null || after == null) {
    return;
  }
  final changed = after.changedSince(before);
  if (changed.isNotEmpty) {
    stderr.writeln('the build changed files Git tracks or does not ignore:');
    for (final entry in changed) {
      stderr.writeln('  $entry');
    }
    exit(1);
  }
}
