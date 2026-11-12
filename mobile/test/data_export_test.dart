import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/data_export.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_links.dart';
import 'support/pump_until.dart';

void main() {
  late FakeAuthRepository repository;
  late AuthController auth;
  late FakeShareSheet share;

  setUp(() {
    repository = FakeAuthRepository();
    auth = fakeAuthController(session: fakeSession, repository: repository);
    share = FakeShareSheet();
  });

  Future<void> pumpApp(WidgetTester tester) async {
    // Tall enough that the whole account screen is built without scrolling.
    tester.view
      ..physicalSize = const Size(400, 6000)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: AppRoutes.account),
        catalog: FakeCatalogRepository(series: fixtureSeries),
        auth: auth,
        site: const PublicSite(host: 'localhost'),
        share: share,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Finder section(String state) =>
      find.byKey(ValueKey(('account-data-export', state)));
  final status = find.byKey(const ValueKey('account-data-export-status'));
  final request = find.byKey(const ValueKey('account-data-export-request'));
  final download = find.byKey(const ValueKey('account-data-export-download'));
  final failure = find.byKey(const ValueKey('account-data-export-failure'));

  testWidgets('a reader asks for a copy and is told it is being prepared', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, section('none'));
    expect(status, findsNothing);
    expect(download, findsNothing);
    expect(
      find.descendant(of: request, matching: find.text('Request a copy')),
      findsOneWidget,
    );

    await tester.tap(request);
    await pumpUntilFound(tester, section('pending'));

    expect(repository.dataExportRequests, 1);
    expect(
      find.descendant(
        of: status,
        matching: find.text(
          'A copy of your data is being prepared. You are told in your '
          'notifications and by email when it is ready to download.',
        ),
      ),
      findsOneWidget,
    );
    // The API refuses a second open request, so there is nothing to press.
    expect(request, findsNothing);
    expect(download, findsNothing);
  });

  testWidgets('a ready archive is handed to the share sheet as a ZIP file', (
    tester,
  ) async {
    repository
      ..dataExport = DataExport(
        state: DataExportState.ready,
        // Midday, so the day is the same in every zone a test runs in.
        expiresAt: DateTime.utc(2026, 11, 10, 12),
      )
      ..dataExportArchive = [
        [0x50, 0x4b],
        [0x03, 0x04],
      ];
    await pumpApp(tester);
    await pumpUntilFound(tester, section('ready'));
    expect(
      find.descendant(
        of: status,
        matching: find.text(
          'Your copy is ready. You can download it until Nov 10, 2026, after '
          'which it is deleted.',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(of: request, matching: find.text('Request a new copy')),
      findsOneWidget,
    );

    await tester.tap(download);
    await pumpUntilTrue(tester, () => share.files.isNotEmpty);

    final file = share.files.single;
    expect(file.name, 'data-export.zip');
    expect(file.mimeType, 'application/zip');
    expect(file.title, 'Download your data');
    expect(file.bytes, [0x50, 0x4b, 0x03, 0x04]);
  });

  testWidgets('an archive gone since it was shown offers a new request', (
    tester,
  ) async {
    repository.dataExport = DataExport(
      state: DataExportState.ready,
      expiresAt: DateTime.utc(2026, 11, 10, 12),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, section('ready'));
    // Expired on the server while the screen still shows it.
    repository.dataExport = null;

    await tester.tap(download);
    await pumpUntilFound(tester, failure);

    expect(
      find.text(
        'That copy of your data is no longer available. Request a new copy.',
      ),
      findsOneWidget,
    );
    expect(share.files, isEmpty);
    await pumpUntilFound(tester, section('none'));
    expect(download, findsNothing);
  });

  testWidgets('a download that cannot reach the API says so', (tester) async {
    repository
      ..dataExport = DataExport(
        state: DataExportState.ready,
        expiresAt: DateTime.utc(2026, 11, 10, 12),
      )
      ..dataExportDownloadFailure = const AuthFailure(AuthFailureKind.network);
    await pumpApp(tester);
    await pumpUntilFound(tester, section('ready'));

    await tester.tap(download);
    await pumpUntilFound(tester, failure);

    expect(share.files, isEmpty);
    expect(
      tester.widget<FilledButton>(download).onPressed,
      isNotNull,
      reason: 'the reader can try again',
    );
  });

  testWidgets('a session the API turns away on download signs the reader out', (
    tester,
  ) async {
    repository
      ..dataExport = DataExport(
        state: DataExportState.ready,
        expiresAt: DateTime.utc(2026, 11, 10, 12),
      )
      ..dataExportDownloadFailure = const AuthFailure(
        AuthFailureKind.sessionExpired,
      );
    await pumpApp(tester);
    await pumpUntilFound(tester, section('ready'));

    await tester.tap(download);
    await pumpUntilFound(tester, find.byKey(const ValueKey('account-sign-in')));

    expect(auth.session, isNull);
    expect(share.files, isEmpty);
  });

  testWidgets('a request made elsewhere meanwhile is shown as pending', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, section('none'));
    // Asked for on the site while the app still shows no request.
    repository
      ..dataExport = const DataExport(state: DataExportState.pending)
      ..dataExportRequestFailure = const AuthFailure(
        AuthFailureKind.dataExportInProgress,
      );

    await tester.tap(request);
    await pumpUntilFound(tester, failure);

    expect(
      find.text(
        'A copy of your data is already being prepared. You are told when it '
        'is ready.',
      ),
      findsOneWidget,
    );
    await pumpUntilFound(tester, section('pending'));
  });

  testWidgets('an install with no object store says the copy cannot be made', (
    tester,
  ) async {
    repository.dataExportRequestFailure = const AuthFailure(
      AuthFailureKind.storageNotConfigured,
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, section('none'));

    await tester.tap(request);
    await pumpUntilFound(tester, failure);

    expect(
      find.text(
        'Copies of your data cannot be prepared on this site right now. '
        'Contact the site if this continues.',
      ),
      findsOneWidget,
    );
    expect(section('none'), findsOneWidget);
  });

  testWidgets('a request the install gave up on can be made again', (
    tester,
  ) async {
    repository.dataExport = const DataExport(state: DataExportState.failed);
    await pumpApp(tester);
    await pumpUntilFound(tester, section('failed'));
    expect(
      find.descendant(
        of: status,
        matching: find.text(
          'Your last request could not be prepared. Request a copy again.',
        ),
      ),
      findsOneWidget,
    );

    await tester.tap(request);
    await pumpUntilFound(tester, section('pending'));
  });

  testWidgets('a request that could not be read is tried again', (
    tester,
  ) async {
    repository.dataExportReadFailure = const AuthFailure(
      AuthFailureKind.network,
    );
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('account-data-export-error')),
    );
    expect(find.text('Could not load your data download.'), findsOneWidget);

    repository.dataExportReadFailure = null;
    await tester.tap(find.byKey(const ValueKey('account-data-export-retry')));
    await pumpUntilFound(tester, section('none'));
  });

  testWidgets('the request is read again when the account tab comes back', (
    tester,
  ) async {
    repository.dataExport = const DataExport(state: DataExportState.pending);
    await pumpApp(tester);
    await pumpUntilFound(tester, section('pending'));

    Finder tab(String label) => find.descendant(
      of: find.byType(NavigationBar),
      matching: find.text(label),
    );
    await tester.tap(tab('Home'));
    await tester.pump();
    // Built by the worker while the account tab is off screen.
    repository.dataExport = DataExport(
      state: DataExportState.ready,
      expiresAt: DateTime.utc(2026, 11, 10, 12),
    );
    await tester.tap(tab('Account'));
    await pumpUntilFound(tester, section('ready'));
  });
}
