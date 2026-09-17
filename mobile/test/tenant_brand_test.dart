import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/router.dart';
import 'package:publira/tenant/tenant_brand.dart';
import 'package:publira/tenant/tenant_brand_controller.dart';
import 'package:publira/tenant/tenant_theme.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/fake_tenant_brand.dart';

final _harborPalette = TenantPalette.fromWire(const {
  'primaryColor': '#0b6e4f',
  'backgroundColor': '#f0f7f4',
  'foregroundColor': '#10231c',
});

final _harbor = TenantBrand(
  name: 'Harbor Comics',
  palette: _harborPalette,
  logo: TenantLogo(
    url: Uri.parse('http://images.test/images/tenants/HARBOR/logo'),
    width: 320,
    height: 80,
  ),
);

final _ember = TenantBrand(
  name: 'Ember Press',
  palette: TenantPalette.fromWire(const {
    'primaryColor': '#9c2a00',
    'backgroundColor': '#fff6ef',
    'foregroundColor': '#2b1308',
  }),
  logo: TenantLogo(
    url: Uri.parse('http://images.test/images/tenants/EMBER/logo'),
    width: 240,
    height: 60,
  ),
);

void main() {
  group('TenantPalette', () {
    test('reads the tenant colours and falls back for unusable ones', () {
      final palette = TenantPalette.fromWire(const {
        'primaryColor': '#0B6E4F',
        'secondaryColor': 'teal',
        'accentColor': 7,
      });

      expect(palette[TenantColor.primary], const Color(0xFF0B6E4F));
      expect(palette[TenantColor.secondary], TenantColor.secondary.fallback);
      expect(palette[TenantColor.accent], TenantColor.accent.fallback);
      expect(palette[TenantColor.background], const Color(0xFFF5F5F2));
    });

    test('a tenant with no theme is the brand defaults', () {
      final palette = TenantPalette.fromWire(null);

      for (final color in TenantColor.values) {
        expect(palette[color], color.fallback, reason: color.name);
      }
    });

    test('what it writes reads back as the same colours', () {
      final written = TenantPalette.fromWire(const {
        'primaryColor': '#0b6e4f',
        'successColor': '#00ff00',
      }).toWire();

      expect(written, const {
        'primaryColor': '#0b6e4f',
        'successColor': '#00ff00',
      });
    });
  });

  group('tenant themes', () {
    test('the light theme is the tenant palette', () {
      final theme = tenantLightTheme(_harborPalette);

      expect(theme.colorScheme.primary, const Color(0xFF0B6E4F));
      expect(theme.colorScheme.surface, const Color(0xFFF0F7F4));
      expect(theme.colorScheme.onSurface, const Color(0xFF10231C));
      expect(
        theme.extension<TenantStatusColors>()?.success,
        TenantColor.success.fallback,
      );
    });

    test('the dark theme is derived from the tenant primary colour', () {
      final other = TenantPalette.fromWire(const {'primaryColor': '#9c2a00'});

      final harbor = tenantDarkTheme(_harborPalette).colorScheme;
      final ember = tenantDarkTheme(other).colorScheme;

      expect(harbor.brightness, Brightness.dark);
      expect(harbor.primary, isNot(ember.primary));
    });
  });

  group('TenantBrandController', () {
    test(
      'answers with the saved brand first, then keeps the fresh one',
      () async {
        final library = InMemoryOfflineLibrary()..tenant = _ember;
        final gate = Completer<void>();
        final repository = FakeTenantBrandRepository(
          brand: _harbor,
          gate: gate,
        );
        final controller = TenantBrandController(
          repository: repository,
          library: library,
        );

        final started = controller.start();
        await pumpEventQueue();
        expect(controller.brand?.name, _ember.name);

        gate.complete();
        await started;
        expect(controller.brand?.name, _harbor.name);
        expect(library.tenant?.name, _harbor.name);
      },
    );

    test('an API that cannot answer leaves the saved brand in place', () async {
      final library = InMemoryOfflineLibrary()..tenant = _ember;
      final controller = TenantBrandController(
        repository: FakeTenantBrandRepository(brand: null),
        library: library,
      );

      await controller.start();

      expect(controller.brand?.name, _ember.name);
      expect(library.tenant?.name, _ember.name);
    });
  });

  group('the app', () {
    Future<void> pumpApp(
      WidgetTester tester, {
      required TenantBrandController tenantBrand,
    }) async {
      await tester.pumpWidget(
        PubliraApp(
          // A second tenant is a second launch, not the first app rebuilt.
          key: ObjectKey(tenantBrand),
          router: createAppRouter(),
          catalog: FakeCatalogRepository(series: fixtureSeries),
          auth: fakeAuthController(),
          offline: InMemoryOfflineLibrary(),
          tenantBrand: tenantBrand,
        ),
      );
      await tester.pump();
      // MaterialApp animates a theme change, which the brand arriving is.
      await tester.pump(const Duration(milliseconds: 500));
    }

    ColorScheme catalogColors(WidgetTester tester) =>
        Theme.of(tester.element(find.byType(AppBar))).colorScheme;

    Uri logoUrl(WidgetTester tester) {
      final image = tester.widget<Image>(
        find.byKey(const ValueKey('catalog-logo')),
      );
      return Uri.parse((image.image as NetworkImage).url);
    }

    testWidgets('two tenants from the same source differ in colours and logo', (
      tester,
    ) async {
      await pumpApp(
        tester,
        tenantBrand: TenantBrandController(
          repository: FakeTenantBrandRepository(brand: _harbor),
        ),
      );
      final harborPrimary = catalogColors(tester).primary;
      final harborLogo = logoUrl(tester);

      await pumpApp(
        tester,
        tenantBrand: TenantBrandController(
          repository: FakeTenantBrandRepository(brand: _ember),
        ),
      );

      expect(harborPrimary, const Color(0xFF0B6E4F));
      expect(catalogColors(tester).primary, const Color(0xFF9C2A00));
      expect(harborLogo, _harbor.logo!.url);
      expect(logoUrl(tester), _ember.logo!.url);
    });

    testWidgets('the logo is fetched with the tenant image headers', (
      tester,
    ) async {
      await pumpApp(
        tester,
        tenantBrand: TenantBrandController(
          repository: FakeTenantBrandRepository(brand: _ember),
          logoRequestHeaders: const {'x-forwarded-host': 'ember.test'},
        ),
      );

      final image = tester.widget<Image>(
        find.byKey(const ValueKey('catalog-logo')),
      );
      expect((image.image as NetworkImage).headers, const {
        'x-forwarded-host': 'ember.test',
      });
    });

    testWidgets('a tenant with no logo is named in the catalog app bar', (
      tester,
    ) async {
      await pumpApp(
        tester,
        tenantBrand: TenantBrandController(
          repository: FakeTenantBrandRepository(),
        ),
      );

      expect(find.byKey(const ValueKey('catalog-logo')), findsNothing);
      expect(
        find.descendant(
          of: find.byType(AppBar),
          matching: find.text(fixtureTenantBrand.name),
        ),
        findsOneWidget,
      );
    });

    testWidgets('a launch without a network is in the saved tenant colours', (
      tester,
    ) async {
      await pumpApp(
        tester,
        tenantBrand: TenantBrandController(
          repository: FakeTenantBrandRepository(brand: null),
          library: InMemoryOfflineLibrary()..tenant = _ember,
        ),
      );

      expect(catalogColors(tester).primary, const Color(0xFF9C2A00));
    });
  });
}
