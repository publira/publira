import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

/// How the app picks the language it renders in, and that every layer of
/// copy follows it: the catalog compiled from `locales/*.json`, and the
/// strings Material ships itself.
void main() {
  Future<void> pumpApp(
    WidgetTester tester, {
    required List<Locale> deviceLocales,
    ValueListenable<String?>? tenantDefaultLocale,
    String initialLocation = '/no-such-page',
  }) async {
    tester.platformDispatcher.localesTestValue = deviceLocales;
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: initialLocation),
        catalog: FakeCatalogRepository(
          series: fixtureSeries,
          details: fixtureDetails(),
        ),
        auth: fakeAuthController(),
        tenantDefaultLocale: tenantDefaultLocale,
      ),
    );
    await tester.pump();
  }

  testWidgets('a device set to Japanese reads the Japanese catalog', (
    tester,
  ) async {
    await pumpApp(tester, deviceLocales: const [Locale('ja', 'JP')]);

    expect(find.text('ページが見つかりません'), findsOneWidget);
    expect(find.text('カタログへ戻る'), findsOneWidget);
    expect(find.text('Page not found'), findsNothing);
  });

  testWidgets('a device set to English reads the English catalog', (
    tester,
  ) async {
    await pumpApp(tester, deviceLocales: const [Locale('en', 'GB')]);

    expect(find.text('Page not found'), findsOneWidget);
    expect(find.text('Back to the catalog'), findsOneWidget);
  });

  testWidgets("Material's own strings follow the app's locale", (tester) async {
    await pumpApp(
      tester,
      deviceLocales: const [Locale('ja')],
      initialLocation: AppRoutes.catalog,
    );
    await tester.tap(
      find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
    );
    await pumpUntilFound(tester, find.text('エピソード一覧'));

    // The back button is Material's, and its tooltip is what it ships for
    // `ja`, which only reaches the screen through the global delegates.
    expect(find.byTooltip('戻る'), findsOneWidget);
  });

  testWidgets('a device with no supported language takes the tenant default', (
    tester,
  ) async {
    await pumpApp(
      tester,
      deviceLocales: const [Locale('fr', 'FR')],
      tenantDefaultLocale: ValueNotifier<String?>('ja'),
    );

    expect(find.text('ページが見つかりません'), findsOneWidget);
  });

  testWidgets('the tenant default is applied once the lookup answers', (
    tester,
  ) async {
    final tenantDefaultLocale = ValueNotifier<String?>(null);
    addTearDown(tenantDefaultLocale.dispose);
    await pumpApp(
      tester,
      deviceLocales: const [Locale('fr', 'FR')],
      tenantDefaultLocale: tenantDefaultLocale,
    );

    expect(find.text('Page not found'), findsOneWidget);

    tenantDefaultLocale.value = 'ja';
    await tester.pump();

    expect(find.text('ページが見つかりません'), findsOneWidget);
    expect(find.text('Page not found'), findsNothing);
  });

  testWidgets('the device keeps precedence over the tenant default', (
    tester,
  ) async {
    await pumpApp(
      tester,
      deviceLocales: const [Locale('en', 'US')],
      tenantDefaultLocale: ValueNotifier<String?>('ja'),
    );

    expect(find.text('Page not found'), findsOneWidget);
  });

  testWidgets('changing the device language while running re-renders', (
    tester,
  ) async {
    await pumpApp(tester, deviceLocales: const [Locale('en')]);
    expect(find.text('Page not found'), findsOneWidget);

    tester.platformDispatcher.localesTestValue = const [Locale('ja')];
    await tester.pump();

    expect(find.text('ページが見つかりません'), findsOneWidget);
  });
}
