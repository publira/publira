// Checks a tenant build manifest, reporting every problem in it at once.
//
//   dart run scripts/tenant_manifest.dart [<manifest>]
//
// Without an argument it checks config/tenant.default.yaml, Publira's own.

import 'dart:io';

import 'tenant/manifest.dart';

Future<void> main(List<String> arguments) async {
  if (arguments.length > 1 || arguments.any((a) => a.startsWith('-'))) {
    stderr.writeln('usage: dart run scripts/tenant_manifest.dart [<manifest>]');
    exit(2);
  }
  final file = arguments.isEmpty
      ? File.fromUri(Platform.script.resolve('../config/tenant.default.yaml'))
      : File(arguments.single);

  try {
    final manifest = await TenantManifest.load(file);
    stdout.writeln(
      '${file.path}: ${manifest.appName} for ${manifest.tenantHost} '
      '(Android ${manifest.androidApplicationId}, '
      'iOS ${manifest.iosBundleIdentifier})',
    );
  } on TenantManifestException catch (error) {
    stderr.writeln(error);
    exit(1);
  }
}
