import 'package:flutter_test/flutter_test.dart';

import '../scripts/app_manifest/flutter_build.dart';
import '../scripts/app_manifest/manifest.dart';

const _manifest = AppManifest(
  appName: 'Example Reader',
  tenantHost: 'reader.example.com',
  androidApplicationId: 'com.example.reader',
  iosBundleIdentifier: 'com.example.reader',
);

const _addresses = {'PUBLIRA_BASE_URL': 'https://reader.example.com'};

List<String> _build(
  List<String> arguments, [
  Map<String, String> environment = _addresses,
]) => flutterBuildArguments(
  BuildRequest.parse(['app.yaml', ...arguments]),
  _manifest,
  environment,
);

/// The problems [arguments] are refused with.
List<String> _problemsOf(
  List<String> arguments, [
  Map<String, String> environment = _addresses,
]) {
  try {
    _build(arguments, environment);
  } on BuildException catch (error) {
    return error.problems;
  }
  fail('the build was accepted');
}

void main() {
  group('the command line', () {
    test('names a manifest and a target', () {
      final request = BuildRequest.parse([
        'tenant/app.yaml',
        'appbundle',
        '--build-number=7',
      ]);
      expect(request.manifestPath, 'tenant/app.yaml');
      expect(request.target, 'appbundle');
      expect(request.flutterArguments, ['--build-number=7']);
    });

    for (final arguments in [
      <String>[],
      ['app.yaml'],
      ['app.yaml', 'web'],
      ['--flavor', 'production'],
      ['apk', 'app.yaml'],
    ]) {
      test(
        'refuses ${arguments.isEmpty ? 'nothing' : arguments.join(' ')}',
        () {
          expect(
            () => BuildRequest.parse(arguments),
            throwsA(
              isA<BuildException>().having(
                (error) => error.problems.single,
                'problem',
                startsWith('usage: task mobile:build'),
              ),
            ),
          );
        },
      );
    }
  });

  group('a production build', () {
    test('is what a build naming no flavor makes', () {
      expect(_build(['appbundle']), [
        'build',
        'appbundle',
        '--flavor',
        'production',
        '--dart-define=PUBLIRA_TENANT_HOST=reader.example.com',
        '--dart-define=PUBLIRA_BASE_URL=https://reader.example.com',
      ]);
    });

    test('passes the other arguments on after its own', () {
      expect(
        _build([
          'ipa',
          '--flavor=production',
          '--dart-define=PUBLIRA_FIREBASE_PROJECT_ID=reader',
        ]),
        [
          'build',
          'ipa',
          '--dart-define=PUBLIRA_TENANT_HOST=reader.example.com',
          '--dart-define=PUBLIRA_BASE_URL=https://reader.example.com',
          '--flavor=production',
          '--dart-define=PUBLIRA_FIREBASE_PROJECT_ID=reader',
        ],
      );
    });

    test('requires the address', () {
      expect(_problemsOf(['apk'], const {}), [
        startsWith('PUBLIRA_BASE_URL is required for a production build'),
      ]);
    });

    for (final url in [
      'http://reader.example.com',
      'reader.example.com',
      'https://',
    ]) {
      test('refuses the address $url', () {
        expect(_problemsOf(['apk'], {..._addresses, 'PUBLIRA_BASE_URL': url}), [
          'PUBLIRA_BASE_URL must be an https:// URL for a production '
              'build, not $url',
        ]);
      });
    }
  });

  group('a development build', () {
    test('keeps the app defaults for addresses it is not given', () {
      expect(_build(['apk', '--flavor', 'dev', '--debug'], const {}), [
        'build',
        'apk',
        '--dart-define=PUBLIRA_TENANT_HOST=reader.example.com',
        '--flavor',
        'dev',
        '--debug',
      ]);
    });

    test('may reach a local stack over http://', () {
      expect(
        _build(
          ['apk', '--flavor=dev'],
          const {'PUBLIRA_BASE_URL': 'http://10.0.2.2:8000'},
        ),
        contains('--dart-define=PUBLIRA_BASE_URL=http://10.0.2.2:8000'),
      );
    });
  });

  group('the defines the command sets', () {
    test('cannot be given as arguments too', () {
      expect(
        _problemsOf([
          'apk',
          '--dart-define=PUBLIRA_TENANT_HOST=other.example',
          '--dart-define',
          'PUBLIRA_BASE_URL=https://other.example',
        ]),
        [
          "--dart-define=PUBLIRA_TENANT_HOST is the manifest's tenant.host; "
              'leave it out',
          '--dart-define=PUBLIRA_BASE_URL is read from the environment; '
              'export PUBLIRA_BASE_URL instead',
        ],
      );
    });
  });
}
