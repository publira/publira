// The tenant build manifest: the identity one tenant's app is built and
// published under, read and checked before a platform build is started.
//
// `config/tenant.schema.json` describes the same format to an editor. The
// patterns below are the ones it carries, which test/tenant_manifest_test.dart
// holds the two to.

import 'dart:io';

import 'package:yaml/yaml.dart';

/// The one manifest format this tool understands.
const tenantManifestSchemaVersion = 1;

/// What an Android `applicationId` may be: two or more segments, each starting
/// with a letter and made of letters, digits, and underscores.
const androidApplicationIdPattern =
    r'^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$';

/// What an iOS `CFBundleIdentifier` may be: reverse-DNS segments of letters,
/// digits, and hyphens.
const iosBundleIdentifierPattern = r'^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$';

/// A lowercase DNS name, which is what App Links and Universal Links are
/// verified against. A last label of digits alone is an IPv4 address, which
/// neither platform associates an app with.
const tenantHostPattern =
    r'^(?=.{1,253}$)(?!(.*\.)?[0-9]+$)'
    r'[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$';

/// A name the home screen can show: no control characters, and no whitespace
/// at either end.
const appNamePattern =
    r'^[^\s\x00-\x1F\x7F]([^\x00-\x1F\x7F]*[^\s\x00-\x1F\x7F])?$';

/// The fields of each section, in the order a problem is reported in.
const _sections = <String, List<String>>{
  'app': ['name'],
  'tenant': ['host'],
  'android': ['applicationId'],
  'ios': ['bundleIdentifier'],
};

/// A validated tenant manifest.
class TenantManifest {
  const TenantManifest({
    required this.appName,
    required this.tenantHost,
    required this.androidApplicationId,
    required this.iosBundleIdentifier,
  });

  /// Reads and validates the manifest at [file].
  static Future<TenantManifest> load(File file) async {
    final String text;
    try {
      text = await file.readAsString();
    } on FileSystemException catch (error) {
      throw TenantManifestException(file.path, [
        TenantManifestIssue('', 'cannot be read: ${error.osError ?? error}'),
      ]);
    }
    return parse(text, source: file.path);
  }

  /// Validates the manifest [text], naming [source] in every problem it
  /// reports. Every problem is reported at once, so that one run is enough to
  /// see what to fix.
  static TenantManifest parse(String text, {required String source}) {
    final Object? document;
    try {
      document = loadYaml(text, sourceUrl: Uri.file(source));
    } on YamlException catch (error) {
      final span = error.span;
      final at = span == null
          ? ''
          : ' (line ${span.start.line + 1}, column ${span.start.column + 1})';
      throw TenantManifestException(source, [
        TenantManifestIssue('', 'is not valid YAML$at: ${error.message}'),
      ]);
    }

    final issues = <TenantManifestIssue>[];
    if (document is! YamlMap) {
      throw TenantManifestException(source, [
        const TenantManifestIssue('', 'must be a mapping of fields'),
      ]);
    }

    final version = document['schemaVersion'];
    if (version == null) {
      issues.add(
        const TenantManifestIssue(
          'schemaVersion',
          'is required; write `schemaVersion: $tenantManifestSchemaVersion`',
        ),
      );
    } else if (version != tenantManifestSchemaVersion) {
      // Every other rule belongs to a version, so nothing else can be judged.
      throw TenantManifestException(source, [
        TenantManifestIssue(
          'schemaVersion',
          '${_describe(version)} is not supported; this tool reads version '
              '$tenantManifestSchemaVersion',
        ),
      ]);
    }

    for (final key in document.keys) {
      if (key != 'schemaVersion' && !_sections.containsKey(key)) {
        issues.add(TenantManifestIssue('$key', _unknownField(_sections.keys)));
      }
    }

    final values = <String, String>{};
    for (final MapEntry(key: section, value: fields) in _sections.entries) {
      final node = document[section];
      if (node == null) {
        issues.add(
          TenantManifestIssue(
            section,
            'is required, with ${_list(fields.map((f) => '`$f`'))}',
          ),
        );
        continue;
      }
      if (node is! YamlMap) {
        issues.add(TenantManifestIssue(section, 'must be a mapping of fields'));
        continue;
      }
      for (final key in node.keys) {
        if (!fields.contains(key)) {
          issues.add(
            TenantManifestIssue('$section.$key', _unknownField(fields)),
          );
        }
      }
      for (final field in fields) {
        final path = '$section.$field';
        final value = node[field];
        if (value == null) {
          issues.add(TenantManifestIssue(path, 'is required'));
        } else if (value is! String) {
          issues.add(
            TenantManifestIssue(
              path,
              'must be a string, not ${_describe(value)}; quote it',
            ),
          );
        } else {
          final problem = _validators[path]!(value);
          if (problem == null) {
            values[path] = value;
          } else {
            issues.add(TenantManifestIssue(path, problem));
          }
        }
      }
    }

    if (issues.isNotEmpty) {
      throw TenantManifestException(source, issues);
    }
    return TenantManifest(
      appName: values['app.name']!,
      tenantHost: values['tenant.host']!,
      androidApplicationId: values['android.applicationId']!,
      iosBundleIdentifier: values['ios.bundleIdentifier']!,
    );
  }

  /// The name the app is shown under on the home screen.
  final String appName;

  /// The one tenant this build serves, whose domain its links are verified
  /// against.
  final String tenantHost;

  /// The production Android `applicationId`. It is kept apart from
  /// [iosBundleIdentifier] so that an app moving to Publira keeps whichever
  /// identifier each store already knows it by.
  final String androidApplicationId;

  /// The production iOS bundle identifier.
  final String iosBundleIdentifier;
}

/// One problem found in a manifest, at the dotted [path] of the field it is
/// about, or at the document itself when [path] is empty.
class TenantManifestIssue {
  const TenantManifestIssue(this.path, this.message);

  final String path;
  final String message;

  @override
  String toString() =>
      path.isEmpty ? 'the manifest $message' : '$path $message';
}

/// Thrown when the manifest at [source] cannot be built from.
class TenantManifestException implements Exception {
  TenantManifestException(this.source, List<TenantManifestIssue> issues)
    : issues = List.unmodifiable(issues);

  final String source;
  final List<TenantManifestIssue> issues;

  @override
  String toString() => [
    '$source is not a valid tenant manifest:',
    for (final issue in issues) '  - $issue',
  ].join('\n');
}

final _validators = <String, String? Function(String)>{
  'app.name': _validateAppName,
  'tenant.host': _validateTenantHost,
  'android.applicationId': _validateAndroidApplicationId,
  'ios.bundleIdentifier': _validateIosBundleIdentifier,
};

String? _validateAppName(String value) {
  if (value.trim().isEmpty) {
    return 'must not be empty';
  }
  if (value.trim() != value) {
    return '"$value" must not start or end with whitespace';
  }
  if (!RegExp(appNamePattern).hasMatch(value)) {
    return 'must not contain control characters such as a line break';
  }
  return null;
}

String? _validateTenantHost(String value) {
  const example = 'e.g. reader.example.jp';
  if (value.contains('://')) {
    return '"$value" must be the host name alone, without a scheme ($example)';
  }
  if (value.contains(RegExp('[/:?#@]'))) {
    return '"$value" must be the host name alone, without a port, path, or '
        'user ($example)';
  }
  if (value.toLowerCase() != value) {
    return '"$value" must be written in lowercase '
        '("${value.toLowerCase()}")';
  }
  if (value.endsWith('.')) {
    return '"$value" must not end with a dot';
  }
  if (RegExp(r'^[0-9.]+$').hasMatch(value)) {
    return '"$value" must be a domain name, not an IP address';
  }
  if (!RegExp(tenantHostPattern).hasMatch(value)) {
    return '"$value" is not a valid host name: each dot-separated label must '
        'be 1 to 63 letters, digits, or hyphens, not starting or ending with a '
        'hyphen, and a non-ASCII domain is written in its xn-- form ($example)';
  }
  return null;
}

String? _validateAndroidApplicationId(String value) {
  if (!RegExp(androidApplicationIdPattern).hasMatch(value)) {
    return '"$value" is not a valid Android application ID: it needs at least '
        'two dot-separated segments, and each must start with a letter and '
        'contain only letters, digits, and underscores (e.g. jp.example.reader)';
  }
  return null;
}

String? _validateIosBundleIdentifier(String value) {
  if (!RegExp(iosBundleIdentifierPattern).hasMatch(value)) {
    return '"$value" is not a valid iOS bundle identifier: it needs at least '
        'two dot-separated segments, each containing only letters, digits, and '
        'hyphens (e.g. jp.example.reader)';
  }
  return null;
}

String _unknownField(Iterable<String> known) =>
    'is not a known field; expected ${_list(known.map((f) => '`$f`'))}';

String _list(Iterable<String> items) {
  final all = items.toList();
  return all.length == 1
      ? all.single
      : '${all.take(all.length - 1).join(', ')} and ${all.last}';
}

String _describe(Object? value) => switch (value) {
  String() => '"$value"',
  YamlMap() || Map() => 'a mapping',
  YamlList() || List() => 'a list',
  _ => '$value',
};
