// Generating the build configuration the platform builds read.

import 'dart:io';

import 'android.dart';
import 'generated_files.dart';
import 'manifest.dart';

/// Validates the manifest at [file] and writes the build configuration for it
/// into [directory]. Nothing is written for a manifest that is not valid.
Future<AppManifest> generateBuildConfiguration(
  File file,
  Directory directory,
) async {
  final manifest = await AppManifest.load(file);
  await writeGeneratedFiles(
    directory,
    androidGeneratedFiles(manifest, source: file.path),
  );
  return manifest;
}
