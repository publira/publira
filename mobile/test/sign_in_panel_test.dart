import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/sign_in_panel.dart';
import 'package:publira/tenant/tenant_brand.dart';
import 'package:publira/tenant/tenant_brand_controller.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/fake_tenant_brand.dart';

final _palette = TenantPalette.fromWire(const {
  'primaryColor': '#0b6e4f',
  'primaryForegroundColor': '#f0f7f4',
});

final _withImage = TenantBrand(
  name: 'Harbor Comics',
  palette: _palette,
  signInImage: TenantImage(
    url: Uri.parse('http://images.test/images/tenants/HARBOR/sign_in'),
    width: 1600,
    height: 1200,
  ),
);

final _withoutImage = TenantBrand(name: 'Harbor Comics', palette: _palette);

/// Every window the app lays out differently for: a phone held either way, and
/// a tablet held either way.
const _sizes = [
  Size(400, 800),
  Size(800, 400),
  Size(800, 1280),
  Size(1280, 800),
];

void main() {
  final panel = find.byType(SignInPanel);
  final image = find.byKey(const ValueKey('sign-in-panel-image'));
  final ground = find.byKey(const ValueKey('sign-in-panel-ground'));
  final email = find.byKey(const ValueKey('sign-in-email'));
  final submit = find.byKey(const ValueKey('sign-in-submit'));

  Future<void> pumpSignIn(
    WidgetTester tester,
    TenantBrand brand, {
    Size size = const Size(400, 800),
  }) async {
    tester.view
      ..physicalSize = size
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: AppRoutes.signIn),
        catalog: FakeCatalogRepository(series: fixtureSeries),
        auth: fakeAuthController(),
        offline: InMemoryOfflineLibrary(),
        tenantBrand: TenantBrandController(
          tenantHost: 'localhost',
          repository: FakeTenantBrandRepository(brand: brand),
          imageRequestHeaders: const {'x-forwarded-host': 'harbor.test'},
        ),
      ),
    );
    await tester.pump();
    // MaterialApp animates a theme change, which the brand arriving is.
    await tester.pump(const Duration(milliseconds: 500));
  }

  testWidgets('the tenant sign-in image is fetched with the tenant headers', (
    tester,
  ) async {
    await pumpSignIn(tester, _withImage);

    final provider = tester.widget<Image>(image).image as NetworkImage;
    expect(Uri.parse(provider.url), _withImage.signInImage!.url);
    expect(provider.headers, const {'x-forwarded-host': 'harbor.test'});
    expect(tester.widget<Image>(image).fit, BoxFit.cover);
  });

  testWidgets('a tenant with no image gets its own colours, not a blank area', (
    tester,
  ) async {
    await pumpSignIn(tester, _withoutImage);

    expect(image, findsNothing);
    expect(
      tester.renderObject(ground),
      paints
        ..rect(color: const Color(0xFF0B6E4F))
        ..rect(color: const Color(0xFFF0F7F4).withValues(alpha: 0.16)),
    );
    expect(tester.getSize(ground), tester.getSize(panel));
  });

  testWidgets('the tenant colours stand in for an image that cannot load', (
    tester,
  ) async {
    // A widget test answers every HTTP request with an error.
    await pumpSignIn(tester, _withImage);
    await tester.pumpAndSettle();

    expect(image, findsOneWidget);
    expect(find.descendant(of: image, matching: ground), findsOneWidget);
  });

  testWidgets('the panel is left out of the semantics tree', (tester) async {
    final semantics = tester.ensureSemantics();
    await pumpSignIn(tester, _withImage);

    expect(
      find.descendant(
        of: panel,
        matching: find.byWidgetPredicate(
          (widget) => widget is ExcludeSemantics && widget.excluding,
        ),
      ),
      findsOneWidget,
    );
    expect(tester.widget<Image>(image).excludeFromSemantics, isTrue);
    expect(tester.widget<Image>(image).semanticLabel, isNull);
    semantics.dispose();
  });

  for (final size in _sizes) {
    testWidgets('the form clears the panel in a ${size.width.toInt()}x'
        '${size.height.toInt()} window', (tester) async {
      await pumpSignIn(tester, _withImage, size: size);

      final panelRect = tester.getRect(panel);
      final emailRect = tester.getRect(email);
      final submitRect = tester.getRect(submit);
      expect(panelRect.overlaps(emailRect), isFalse);
      expect(panelRect.overlaps(submitRect), isFalse);
      if (size.width >= signInPanelBesideWidth) {
        expect(panelRect.left, greaterThanOrEqualTo(emailRect.right));
        expect(panelRect.height, greaterThan(signInPanelBandHeight));
      } else {
        expect(panelRect.bottom, lessThanOrEqualTo(emailRect.top));
        expect(panelRect.height, signInPanelBandHeight);
      }
    });
  }
}
