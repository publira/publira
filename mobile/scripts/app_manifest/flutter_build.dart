// The `flutter build` command line a tenant build runs, composed from the app
// manifest it was generated from and the arguments the builder gave.

import 'manifest.dart';

/// The `flutter build` subcommands that produce an app a store takes.
const buildTargets = {'apk', 'appbundle', 'ios', 'ipa'};

/// The targets whose build Xcode runs, which reads the generated
/// configuration from the default directory only.
const xcodeBuildTargets = {'ios', 'ipa'};

/// The flavor a build names none for: a tenant build is the one it publishes.
const defaultBuildFlavor = 'production';

/// The defines the command sets itself. The tenant host is the manifest's,
/// and the two addresses come from the environment variables of the same name.
const tenantHostDefine = 'PUBLIRA_TENANT_HOST';
const apiBaseUrlDefine = 'PUBLIRA_API_BASE_URL';
const imageBaseUrlDefine = 'PUBLIRA_IMAGE_BASE_URL';

/// What `scripts/build.dart` was asked to build.
class BuildRequest {
  const BuildRequest({
    required this.manifestPath,
    required this.target,
    required this.flutterArguments,
  });

  /// Reads `<manifest> <target> [flutter build arguments]`.
  factory BuildRequest.parse(List<String> arguments) {
    if (arguments.length < 2 ||
        arguments[0].startsWith('-') ||
        !buildTargets.contains(arguments[1])) {
      throw const BuildException([
        'usage: task mobile:build -- <manifest> '
            '<apk|appbundle|ios|ipa> [flutter build arguments]',
      ]);
    }
    return BuildRequest(
      manifestPath: arguments[0],
      target: arguments[1],
      flutterArguments: arguments.sublist(2),
    );
  }

  final String manifestPath;
  final String target;
  final List<String> flutterArguments;

  /// The flavor the arguments name, else [defaultBuildFlavor].
  String get flavor =>
      _optionValues(flutterArguments, 'flavor').lastOrNull ??
      defaultBuildFlavor;
}

/// Thrown for a build that is refused before Flutter is started.
class BuildException implements Exception {
  const BuildException(this.problems);

  final List<String> problems;

  @override
  String toString() => problems.join('\n');
}

/// The arguments after `flutter` that build [request] for [manifest], with
/// the addresses the app connects to read from [environment].
///
/// A production build is refused without both addresses, since the app's
/// defaults are a loopback stack no reader's device has. Every problem is
/// reported at once.
List<String> flutterBuildArguments(
  BuildRequest request,
  AppManifest manifest,
  Map<String, String> environment,
) {
  final problems = <String>[];
  final given = _optionValues(
    request.flutterArguments,
    'dart-define',
  ).map((define) => define.split('=').first).toSet();
  for (final name in [tenantHostDefine, apiBaseUrlDefine, imageBaseUrlDefine]) {
    if (given.contains(name)) {
      problems.add(
        name == tenantHostDefine
            ? '--dart-define=$name is the manifest\'s tenant.host; '
                  'leave it out'
            : '--dart-define=$name is read from the environment; '
                  'export $name instead',
      );
    }
  }

  final production = request.flavor == defaultBuildFlavor;
  final addresses = <String, String>{};
  for (final name in [apiBaseUrlDefine, imageBaseUrlDefine]) {
    final value = environment[name] ?? '';
    if (value.isEmpty) {
      if (production) {
        problems.add(
          '$name is required for a production build; export the address '
          'the deployment serves it on',
        );
      }
      continue;
    }
    // A release Android build refuses cleartext traffic, so a store build
    // reaching its API over http:// would fail only on the reader's device.
    final uri = Uri.tryParse(value);
    final schemes = production ? const ['https'] : const ['http', 'https'];
    if (uri == null || uri.host.isEmpty || !schemes.contains(uri.scheme)) {
      problems.add(
        production
            ? '$name must be an https:// URL for a production build, '
                  'not $value'
            : '$name must be an http:// or https:// URL, not $value',
      );
      continue;
    }
    addresses[name] = value;
  }
  if (problems.isNotEmpty) {
    throw BuildException(problems);
  }

  return [
    'build',
    request.target,
    if (_optionValues(request.flutterArguments, 'flavor').isEmpty) ...[
      '--flavor',
      defaultBuildFlavor,
    ],
    '--dart-define=$tenantHostDefine=${manifest.tenantHost}',
    for (final MapEntry(:key, :value) in addresses.entries)
      '--dart-define=$key=$value',
    ...request.flutterArguments,
  ];
}

/// Every value [arguments] give the option [name], written either as
/// `--name=value` or as `--name value`.
List<String> _optionValues(List<String> arguments, String name) {
  final values = <String>[];
  for (var i = 0; i < arguments.length; i++) {
    final argument = arguments[i];
    if (argument.startsWith('--$name=')) {
      values.add(argument.substring(name.length + 3));
    } else if (argument == '--$name' && i + 1 < arguments.length) {
      values.add(arguments[++i]);
    }
  }
  return values;
}
