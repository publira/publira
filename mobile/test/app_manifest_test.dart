import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../scripts/app_manifest/android.dart';
import '../scripts/app_manifest/generate.dart';
import '../scripts/app_manifest/generated_files.dart';
import '../scripts/app_manifest/ios.dart';
import '../scripts/app_manifest/manifest.dart';

const _valid = '''
schemaVersion: 1
app:
  name: Example Reader
tenant:
  host: reader.example.jp
android:
  applicationId: jp.example.reader
ios:
  bundleIdentifier: jp.example.reader
''';

/// [_valid] with the one [field] (`section.key`) set to [value], written as
/// YAML source.
String _with(String field, String value) {
  final line = RegExp('  ${field.split('.').last}: .*');
  assert(line.hasMatch(_valid), 'no field $field');
  return _valid.replaceFirst(line, '  ${field.split('.').last}: $value');
}

/// The problems [text] is reported with, as a reader sees them.
List<String> _issuesOf(String text) {
  try {
    AppManifest.parse(text, source: 'app.yaml');
  } on AppManifestException catch (error) {
    return error.issues.map((issue) => issue.toString()).toList();
  }
  fail('the manifest was accepted');
}

void main() {
  group('the checked-in manifests', () {
    test('Publira defaults to its own identity', () async {
      final manifest = await AppManifest.load(File('config/app.default.yaml'));

      expect(manifest.appName, 'Publira');
      expect(manifest.tenantHost, 'localhost');
      expect(manifest.androidApplicationId, 'dev.publira.app');
      expect(manifest.iosBundleIdentifier, 'dev.publira.app');
    });

    test('the example is a valid manifest for another tenant', () async {
      final manifest = await AppManifest.load(File('config/app.example.yaml'));

      expect(manifest.tenantHost, 'reader.example.jp');
      expect(manifest.androidApplicationId, isNot('dev.publira.app'));
    });

    test('the schema carries the rules the validator applies', () async {
      final schema =
          jsonDecode(await File('config/app.schema.json').readAsString())
              as Map<String, Object?>;
      Map<String, Object?> field(String section, String key) {
        final sections = schema['properties']! as Map<String, Object?>;
        final object = sections[section]! as Map<String, Object?>;
        expect(object['required'], [key]);
        expect(object['additionalProperties'], false);
        final properties = object['properties']! as Map<String, Object?>;
        return properties[key]! as Map<String, Object?>;
      }

      expect(schema['required'], [
        'schemaVersion',
        'app',
        'tenant',
        'android',
        'ios',
      ]);
      expect(
        (schema['properties']! as Map<String, Object?>)['schemaVersion'],
        containsPair('const', appManifestSchemaVersion),
      );
      expect(field('app', 'name')['pattern'], appNamePattern);
      expect(field('tenant', 'host')['pattern'], tenantHostPattern);
      expect(
        field('android', 'applicationId')['pattern'],
        androidApplicationIdPattern,
      );
      expect(
        field('ios', 'bundleIdentifier')['pattern'],
        iosBundleIdentifierPattern,
      );
    });
  });

  group('a valid manifest', () {
    test('yields every field', () {
      final manifest = AppManifest.parse(_valid, source: 'app.yaml');

      expect(manifest.appName, 'Example Reader');
      expect(manifest.tenantHost, 'reader.example.jp');
      expect(manifest.androidApplicationId, 'jp.example.reader');
      expect(manifest.iosBundleIdentifier, 'jp.example.reader');
    });

    test('keeps the Android and iOS identifiers apart', () {
      final manifest = AppManifest.parse(
        _with('ios.bundleIdentifier', 'com.example.Reader-iOS'),
        source: 'app.yaml',
      );

      expect(manifest.androidApplicationId, 'jp.example.reader');
      expect(manifest.iosBundleIdentifier, 'com.example.Reader-iOS');
    });

    test('takes a name in any script', () {
      final manifest = AppManifest.parse(
        _with('app.name', 'Café Reader'),
        source: 'app.yaml',
      );

      expect(manifest.appName, 'Café Reader');
    });
  });

  group('the document', () {
    test('names the file and every problem at once', () {
      try {
        AppManifest.parse('''
schemaVersion: 1
app:
  name: " "
tenant:
  host: https://reader.example.jp
android:
  applicationId: reader
''', source: 'path/to/app.yaml');
        fail('the manifest was accepted');
      } on AppManifestException catch (error) {
        expect(error.source, 'path/to/app.yaml');
        expect(error.issues.map((issue) => issue.path), [
          'app.name',
          'tenant.host',
          'android.applicationId',
          'ios',
        ]);
        expect(
          error.toString(),
          startsWith('path/to/app.yaml is not a valid app manifest:\n'),
        );
      }
    });

    test('reports where malformed YAML breaks', () {
      expect(_issuesOf('schemaVersion: 1\napp: [\n'), [
        matches(RegExp(r'^the manifest is not valid YAML \(line \d+, column')),
      ]);
    });

    test('must be a mapping', () {
      expect(_issuesOf('- schemaVersion: 1\n'), [
        'the manifest must be a mapping of fields',
      ]);
    });

    test('an unreadable file is reported against its path', () async {
      final missing = File('config/does-not-exist.yaml');

      await expectLater(
        AppManifest.load(missing),
        throwsA(
          isA<AppManifestException>()
              .having((error) => error.source, 'source', missing.path)
              .having(
                (error) => error.issues.single.message,
                'message',
                startsWith('cannot be read'),
              ),
        ),
      );
    });

    test('requires a schema version', () {
      expect(_issuesOf(_valid.replaceFirst('schemaVersion: 1\n', '')), [
        'schemaVersion is required; write `schemaVersion: 1`',
      ]);
    });

    test('an unsupported version is the only problem reported', () {
      expect(
        _issuesOf(_valid.replaceFirst('schemaVersion: 1', 'schemaVersion: 2')),
        ['schemaVersion 2 is not supported; this tool reads version 1'],
      );
      expect(_issuesOf('schemaVersion: "1"\n'), [
        'schemaVersion "1" is not supported; this tool reads version 1',
      ]);
    });

    test('requires each section and field', () {
      expect(_issuesOf('schemaVersion: 1\napp: {}\n'), [
        'app.name is required',
        'tenant is required, with `host`',
        'android is required, with `applicationId`',
        'ios is required, with `bundleIdentifier`',
      ]);
    });

    test('rejects a field it does not know, such as a misspelling', () {
      expect(_issuesOf('${_valid}andriod:\n  applicationId: a.b\n'), [
        'andriod is not a known field; expected `app`, `tenant`, `android` '
            'and `ios`',
      ]);
      expect(_issuesOf(_valid.replaceFirst('  name:', '  label: X\n  name:')), [
        'app.label is not a known field; expected `name`',
      ]);
    });

    test('rejects a section that is not a mapping', () {
      expect(
        _issuesOf(_valid.replaceFirst(RegExp(r'app:\n  name: .*'), 'app: X')),
        ['app must be a mapping of fields'],
      );
    });

    test('rejects a value YAML reads as something other than a string', () {
      expect(_issuesOf(_with('app.name', '2024')), [
        'app.name must be a string, not 2024; quote it',
      ]);
      expect(_issuesOf(_with('tenant.host', 'true')), [
        'tenant.host must be a string, not true; quote it',
      ]);
    });
  });

  group('app.name', () {
    for (final (name, value, problem) in [
      ('empty', '""', 'must not be empty'),
      ('blank', '"   "', 'must not be empty'),
      ('padded', '" Reader"', 'must not start or end with whitespace'),
      ('multi-line', r'"Example\nReader"', 'must not contain control'),
      ('holding a tab', r'"Example\tReader"', 'must not contain control'),
    ]) {
      test('rejects a name that is $name', () {
        expect(_issuesOf(_with('app.name', value)), [
          allOf(startsWith('app.name '), contains(problem)),
        ]);
      });
    }
  });

  group('tenant.host', () {
    for (final host in [
      'localhost',
      'reader.example.jp',
      'my-reader.example.co.jp',
      'xn--eckwd4c7c.xn--zckzah',
      '${'a' * 63}.example.jp',
      'reader2.example.jp',
    ]) {
      test('accepts $host', () {
        final manifest = AppManifest.parse(
          _with('tenant.host', host),
          source: 'app.yaml',
        );

        expect(manifest.tenantHost, host);
      });
    }

    for (final (name, value, problem) in [
      ('with a scheme', 'https://reader.example.jp', 'without a scheme'),
      ('with a port', '"reader.example.jp:443"', 'without a port'),
      ('with a path', 'reader.example.jp/app', 'without a port, path'),
      ('in uppercase', 'Reader.Example.jp', '("reader.example.jp")'),
      ('ending in a dot', 'reader.example.jp.', 'must not end with a dot'),
      ('that is an IPv4 address', '"192.0.2.1"', 'not an IP address'),
      ('with an underscore', 'my_reader.example.jp', 'not a valid host name'),
      ('with a leading hyphen', '-reader.example.jp', 'not a valid host name'),
      ('with a trailing hyphen', 'reader-.example.jp', 'not a valid host name'),
      ('with an empty label', 'reader..example.jp', 'not a valid host name'),
      ('with a label too long', '${'a' * 64}.example.jp', 'not a valid host'),
      ('too long', '${'a.' * 127}jp', 'not a valid host name'),
      ('with a numeric TLD', 'reader.example.123', 'not a valid host name'),
      ('in Unicode', 'リーダー.example.jp', 'xn-- form'),
      ('with a wildcard', '"*.example.jp"', 'not a valid host name'),
    ]) {
      test('rejects a host $name', () {
        expect(_issuesOf(_with('tenant.host', value)), [
          allOf(startsWith('tenant.host '), contains(problem)),
        ]);
      });
    }
  });

  group('android.applicationId', () {
    for (final id in ['jp.example.reader', 'com.Example.reader_app', 'a.b']) {
      test('accepts $id', () {
        final manifest = AppManifest.parse(
          _with('android.applicationId', id),
          source: 'app.yaml',
        );

        expect(manifest.androidApplicationId, id);
      });
    }

    for (final id in [
      'reader',
      'jp.example.1reader',
      'jp.example-reader.app',
      'jp..reader',
      'jp.example.reader.',
      '_jp.example',
    ]) {
      test('rejects $id', () {
        expect(_issuesOf(_with('android.applicationId', '"$id"')), [
          allOf(
            startsWith('android.applicationId '),
            contains('is not a valid Android application ID'),
          ),
        ]);
      });
    }
  });

  group('ios.bundleIdentifier', () {
    for (final id in ['jp.example.reader', 'jp.example-reader.1app', 'a.b']) {
      test('accepts $id', () {
        final manifest = AppManifest.parse(
          _with('ios.bundleIdentifier', id),
          source: 'app.yaml',
        );

        expect(manifest.iosBundleIdentifier, id);
      });
    }

    for (final id in [
      'reader',
      'jp.example.reader_app',
      'jp..reader',
      'jp.example.reader.',
      'jp.example.reader app',
    ]) {
      test('rejects $id', () {
        expect(_issuesOf(_with('ios.bundleIdentifier', '"$id"')), [
          allOf(
            startsWith('ios.bundleIdentifier '),
            contains('is not a valid iOS bundle identifier'),
          ),
        ]);
      });
    }
  });

  group('generated files', () {
    late Directory temporary;

    setUp(() async {
      temporary = await Directory.systemTemp.createTemp('app_generated_');
    });

    tearDown(() async {
      await temporary.delete(recursive: true);
    });

    test('are written into a directory that is created on demand', () async {
      final directory = Directory('${temporary.path}/build/a');

      await writeGeneratedFiles(directory, {'app.properties': 'a=1\n'});
      await writeGeneratedFiles(directory, {'app.properties': 'a=2\n'});

      expect(
        await File('${directory.path}/app.properties').readAsString(),
        'a=2\n',
      );
      expect(directory.listSync().map((entry) => entry.uri.pathSegments.last), [
        'app.properties',
      ]);
    });

    test('written concurrently leave one complete file', () async {
      final contents = [for (var i = 0; i < 20; i++) '${'$i' * 10000}\n'];

      await Future.wait([
        for (final text in contents)
          writeGeneratedFiles(temporary, {'App.xcconfig': text}),
      ]);

      expect(
        contents,
        contains(await File('${temporary.path}/App.xcconfig').readAsString()),
      );
      expect(temporary.listSync(), hasLength(1));
    });

    test('are named plainly, never by a path', () async {
      for (final name in [
        '',
        '../escape',
        r'..\escape',
        'C:escape',
        '.hidden',
      ]) {
        await expectLater(
          writeGeneratedFiles(temporary, {name: ''}),
          throwsArgumentError,
        );
      }
    });

    test('go where PUBLIRA_MOBILE_GENERATED_DIR names', () {
      final mobile = Directory('${temporary.path}/mobile');

      expect(
        generatedDirectory(mobile, {}).path,
        defaultGeneratedDirectory(mobile).path,
      );
      expect(
        generatedDirectory(mobile, {generatedDirectoryVariable: ''}).path,
        defaultGeneratedDirectory(mobile).path,
      );
      expect(
        generatedDirectory(mobile, {
          generatedDirectoryVariable: '${temporary.path}/tenant-a',
        }).uri,
        Directory('${temporary.path}/tenant-a').uri,
      );
      // Relative to the app, as Gradle resolves it, rather than to wherever
      // the command happens to run.
      expect(
        generatedDirectory(mobile, {
          generatedDirectoryVariable: 'build/tenant-b',
        }).uri,
        Directory('${temporary.path}/mobile/build/tenant-b').absolute.uri,
      );
    });

    test('default to the ignored directory beside the app', () async {
      final directory = defaultGeneratedDirectory(Directory('.'));
      for (final name in [androidAppProperties, iosAppXcconfig]) {
        final ignored = await Process.run('git', [
          'check-ignore',
          '--quiet',
          '${directory.path}/$name',
        ]);

        expect(ignored.exitCode, 0, reason: name);
      }
    });
  });

  group('the Android build configuration', () {
    /// The properties [manifest] generates, as `java.util.Properties` reads
    /// them: comments dropped, and each backslash escape undone.
    Map<String, String> propertiesOf(AppManifest manifest) {
      final text = androidGeneratedFiles(
        manifest,
        source: 'app.yaml',
      )[androidAppProperties]!;
      return {
        for (final line in const LineSplitter().convert(text))
          if (line.isNotEmpty && !line.startsWith('#'))
            line.substring(0, line.indexOf('=')): line
                .substring(line.indexOf('=') + 1)
                .replaceAllMapped(RegExp(r'\\(.)'), (m) => m[1]!),
      };
    }

    test('carries the tenant identity Gradle reads', () {
      final manifest = AppManifest.parse(_valid, source: 'app.yaml');

      expect(propertiesOf(manifest), {
        'publira.applicationId': 'jp.example.reader',
        'publira.tenantHost': 'reader.example.jp',
        'publira.appName': 'Example Reader',
      });
    });

    test('is the one file Gradle reads', () {
      final manifest = AppManifest.parse(_valid, source: 'app.yaml');

      expect(androidGeneratedFiles(manifest, source: 'app.yaml').keys, [
        'app.properties',
      ]);
    });

    test('keeps whatever characters the name is written in', () {
      for (final name in [
        r'Reader \ Club',
        '漫画リーダー',
        'Reader = #1',
        "Reader's",
      ]) {
        final manifest = AppManifest.parse(
          _with('app.name', jsonEncode(name)),
          source: 'app.yaml',
        );

        expect(propertiesOf(manifest)['publira.appName'], name);
      }
    });

    test('is generated from a manifest file into a directory', () async {
      final temporary = await Directory.systemTemp.createTemp('app_android_');
      addTearDown(() => temporary.delete(recursive: true));
      final directory = Directory('${temporary.path}/out');

      final manifest = await generateBuildConfiguration(
        File('config/app.example.yaml'),
        directory,
      );

      expect(manifest.androidApplicationId, 'jp.example.reader');
      expect(
        await File('${directory.path}/app.properties').readAsString(),
        allOf(
          startsWith('# Generated from config/app.example.yaml'),
          contains('publira.applicationId=jp.example.reader\n'),
        ),
      );
    });

    test('is not generated from a manifest that is not valid', () async {
      final temporary = await Directory.systemTemp.createTemp('app_android_');
      addTearDown(() => temporary.delete(recursive: true));
      final file = File('${temporary.path}/app.yaml');
      await file.writeAsString(_with('android.applicationId', 'reader'));
      final directory = Directory('${temporary.path}/out');

      await expectLater(
        generateBuildConfiguration(file, directory),
        throwsA(isA<AppManifestException>()),
      );
      expect(directory.existsSync(), isFalse);
    });
  });

  group('the iOS build configuration', () {
    /// The settings [manifest] generates, as Xcode reads an xcconfig: a `//`
    /// starts a comment, a trailing `;` is dropped, and each reference is
    /// expanded.
    Map<String, String> settingsOf(AppManifest manifest) {
      final text = iosGeneratedFiles(
        manifest,
        source: 'app.yaml',
      )[iosAppXcconfig]!;
      return {
        for (final line in const LineSplitter().convert(text))
          if (line.split('//').first.trim() case final setting
              when setting.isNotEmpty)
            setting.substring(0, setting.indexOf(' = ')): setting
                .substring(setting.indexOf(' = ') + 3)
                .replaceFirst(RegExp(r';$'), '')
                .replaceAllMapped(
                  RegExp(r'\$\((\w*)\)'),
                  (m) => switch (m[1]) {
                    '' => '',
                    'DOLLAR' => r'$',
                    _ => fail('an unexpected reference ${m[0]}'),
                  },
                ),
      };
    }

    test('carries the tenant identity Xcode reads', () {
      final manifest = AppManifest.parse(
        _with('ios.bundleIdentifier', 'jp.example.reader-ios'),
        source: 'app.yaml',
      );

      expect(settingsOf(manifest), {
        'PUBLIRA_BUNDLE_IDENTIFIER': 'jp.example.reader-ios',
        'PUBLIRA_ASSOCIATED_DOMAIN': 'reader.example.jp',
        'PUBLIRA_APP_NAME': 'Example Reader',
      });
    });

    test('keeps whatever characters the name is written in', () {
      for (final name in [
        'Reader // Club',
        r'$(HOME) Reader',
        r'${HOME}',
        'Reader;',
        'https://reader.example.jp/',
        r'Reader \ "Club"',
        '漫画リーダー',
      ]) {
        final manifest = AppManifest.parse(
          _with('app.name', jsonEncode(name)),
          source: 'app.yaml',
        );

        expect(settingsOf(manifest)['PUBLIRA_APP_NAME'], name);
      }
    });

    test('is read by every Xcode configuration from the default directory', () {
      final generated = defaultGeneratedDirectory(Directory('.')).absolute.uri;

      for (final name in ['Debug', 'Release']) {
        final file = File('ios/Flutter/$name.xcconfig');
        final included = [
          for (final m in RegExp(
            r'^#include "(.+)"$',
            multiLine: true,
          ).allMatches(file.readAsStringSync()))
            file.absolute.uri.resolve(m[1]!),
        ];

        expect(included, contains(generated.resolve(iosAppXcconfig)));
      }
    });

    test('is generated from a manifest file into a directory', () async {
      final temporary = await Directory.systemTemp.createTemp('app_ios_');
      addTearDown(() => temporary.delete(recursive: true));
      final directory = Directory('${temporary.path}/out');

      await generateBuildConfiguration(
        File('config/app.example.yaml'),
        directory,
      );

      expect(
        await File('${directory.path}/App.xcconfig').readAsString(),
        allOf(
          startsWith('// Generated from config/app.example.yaml'),
          contains('PUBLIRA_BUNDLE_IDENTIFIER = jp.example.reader\n'),
        ),
      );
    });
  });

  group('the Xcode build check', () {
    late Directory mobile;

    setUp(() async {
      mobile = await Directory.systemTemp.createTemp('app_xcode_');
      await Directory('${mobile.path}/ios').create();
      await Directory('${mobile.path}/.generated').create();
    });

    tearDown(() async {
      await mobile.delete(recursive: true);
    });

    /// Runs the check as Xcode does, with the build settings in [settings].
    Future<ProcessResult> check(Map<String, String> settings) => Process.run(
      'sh',
      ['scripts/ios-check-app-config.sh'],
      environment: {
        'SRCROOT': '${mobile.path}/ios',
        'CONFIGURATION': 'Debug-dev',
        'PUBLIRA_BUNDLE_IDENTIFIER': 'jp.example.reader',
        'PUBLIRA_ASSOCIATED_DOMAIN': 'reader.example.jp',
        ...settings,
      },
    );

    /// Flutter's DART_DEFINES build setting for [defines].
    String dartDefines(List<String> defines) =>
        defines.map((d) => base64.encode(utf8.encode(d))).join(',');

    test('lets a generated development build through', () async {
      final result = await check({});

      expect(result.exitCode, 0, reason: '${result.stderr}');
    });

    test('stops a build that was not generated', () async {
      final result = await check({'PUBLIRA_BUNDLE_IDENTIFIER': ''});

      expect(result.exitCode, isNot(0));
      expect(
        result.stderr,
        allOf(
          startsWith('error: '),
          contains('.generated/App.xcconfig does not exist'),
          contains('dart run scripts/app_manifest.dart --generate'),
        ),
      );
    });

    test('stops a build generated into a directory Xcode does not read', () {
      return Future.wait([
        for (final (named, passes) in [
          ('.generated', true),
          ('${mobile.path}/.generated', true),
          ('build/tenant-a', false),
          ('/nonexistent', false),
        ])
          check({generatedDirectoryVariable: named}).then((result) {
            expect(result.exitCode == 0, passes, reason: named);
            if (!passes) {
              expect(result.stderr, contains('Unset the variable'));
            }
          }),
      ]);
    });

    test('pins a production build to the manifest tenant', () async {
      for (final (defines, passes) in [
        (['PUBLIRA_TENANT_HOST=reader.example.jp'], true),
        (
          [
            'PUBLIRA_API_BASE_URL=https://api.example.jp',
            'PUBLIRA_TENANT_HOST=reader.example.jp',
          ],
          true,
        ),
        (['PUBLIRA_TENANT_HOST=localhost'], false),
        (<String>[], false),
      ]) {
        for (final configuration in [
          'Debug-production',
          'Release-production',
          'Profile-production',
        ]) {
          final result = await check({
            'CONFIGURATION': configuration,
            'DART_DEFINES': dartDefines(defines),
          });

          expect(result.exitCode == 0, passes, reason: '$defines');
          if (!passes) {
            expect(
              result.stderr,
              contains(
                'error: Production builds require '
                '--dart-define=PUBLIRA_TENANT_HOST=reader.example.jp',
              ),
            );
          }
        }
      }
    });

    test('leaves the development build free to use any tenant', () async {
      final result = await check({
        'DART_DEFINES': dartDefines(['PUBLIRA_TENANT_HOST=localhost']),
      });

      expect(result.exitCode, 0, reason: '${result.stderr}');
    });
  });
}
