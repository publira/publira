import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/progress_outbox.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';

const _episodeId = 'SeedEPSDAAA1';

void main() {
  late FakeCatalogRepository catalog;
  late InMemoryOfflineLibrary library;
  late AuthController auth;
  late ProgressOutbox outbox;

  setUp(() async {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    library = InMemoryOfflineLibrary();
    await library.queueUnsentProgress(
      UnsentProgress(
        readerId: fakeSession.userPublicId,
        episodeId: _episodeId,
        finished: true,
      ),
    );
  });

  Future<void> pumpApp(WidgetTester tester) async {
    outbox = ProgressOutbox(
      origin: catalog,
      library: library,
      readerId: () => auth.session?.userPublicId ?? '',
    );
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(),
        catalog: catalog,
        auth: auth,
        offline: library,
        progress: outbox,
      ),
    );
    await tester.pump();
  }

  testWidgets('a launch signed in sends what was left unsent', (tester) async {
    auth = fakeAuthController(session: fakeSession);

    await pumpApp(tester);

    expect(catalog.markedRead, [_episodeId]);
    expect(library.unsent, isEmpty);
  });

  testWidgets('coming back to the app sends it again', (tester) async {
    auth = fakeAuthController(session: fakeSession);
    catalog.markReadError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester);

    catalog.markReadError = null;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();

    expect(catalog.markedRead, [_episodeId, _episodeId]);
    expect(library.unsent, isEmpty);
  });

  testWidgets('signing in sends what that reader left unsent', (tester) async {
    auth = fakeAuthController();
    await pumpApp(tester);
    expect(catalog.markedRead, isEmpty);

    await auth.signIn(email: 'member@example.com', password: 'password');
    await tester.pump();

    expect(catalog.markedRead, [_episodeId]);
  });

  testWidgets('signing out drops it unsent', (tester) async {
    auth = fakeAuthController(session: fakeSession);
    catalog.markReadError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester);

    await auth.signOut();
    await tester.pump();

    expect(library.unsent, isEmpty);
  });
}
