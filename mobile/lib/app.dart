import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/http_auth_repository.dart';
import 'package:publira/auth/session_store.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/http_catalog_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/locale_negotiation.dart';
import 'package:publira/l10n/localizations.dart';
import 'package:publira/offline/file_offline_library.dart';
import 'package:publira/offline/offline_catalog_repository.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/offline_scope.dart';
import 'package:publira/router.dart';

/// Root widget. Accepts [router], [catalog], and [auth] so tests can inject a
/// fresh [GoRouter], a fake or fixture-backed catalog, and a session that does
/// not touch the platform keychain.
class PubliraApp extends StatefulWidget {
  const PubliraApp({
    super.key,
    required this.router,
    required this.catalog,
    required this.auth,
    this.offline,
    this.tenantDefaultLocale,
  });

  /// Wires the app to the public API described by [config].
  ///
  /// One [ConnectClient] serves the catalog and the auth calls alike, so every
  /// request carries whichever token the reader is signed in with, and one
  /// [TenantResolver] means the tenant is looked up once per run. [store] is
  /// the session's home, which an on-device test replaces so it does not carry
  /// a session from one test to the next.
  ///
  /// [offline] is what the device keeps for reading without a network, which
  /// an on-device test replaces so it does not carry saved episodes from one
  /// test to the next.
  factory PubliraApp.fromConfig({
    Key? key,
    AppConfig? config,
    GoRouter? router,
    SessionStore store = const SecureSessionStore(),
    OfflineLibrary? offline,
  }) {
    final resolved = config ?? AppConfig.fromEnvironment();
    final library = offline ?? FileOfflineLibrary();
    late final AuthController auth;
    final client = ConnectClient(
      baseUrl: resolved.apiBaseUrl,
      accessToken: () => auth.accessToken,
    );
    final tenants = TenantResolver(
      client: client,
      tenantHost: resolved.tenantHost,
    );
    auth = AuthController(
      repository: HttpAuthRepository(
        config: resolved,
        client: client,
        tenants: tenants,
      ),
      store: store,
    );
    return PubliraApp(
      key: key,
      router: router ?? createAppRouter(),
      catalog: OfflineCatalogRepository(
        origin: HttpCatalogRepository(
          config: resolved,
          client: client,
          tenants: tenants,
        ),
        library: library,
        readerId: () => auth.session?.userPublicId ?? '',
      ),
      auth: auth,
      offline: library,
      tenantDefaultLocale: tenants.defaultLocale,
    );
  }

  final GoRouter router;
  final CatalogRepository catalog;
  final AuthController auth;

  /// What the device holds for reading without a network.
  ///
  /// [PubliraApp.fromConfig] always supplies one, and it is that library which
  /// decides at runtime whether the platform can keep anything. It is nullable
  /// for the direct constructor, which a widget test uses to build the app
  /// with no offline behaviour at all.
  final OfflineLibrary? offline;

  /// The tenant's default locale code, once the tenant lookup has learnt it.
  ///
  /// [PubliraApp.fromConfig] hands over what its [TenantResolver] reports; a
  /// widget test passes a [ValueNotifier] to act the answer out, or nothing,
  /// in which case only the device's own languages decide the locale.
  final ValueListenable<String?>? tenantDefaultLocale;

  @override
  State<PubliraApp> createState() => _PubliraAppState();
}

class _PubliraAppState extends State<PubliraApp> with WidgetsBindingObserver {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.auth.addListener(_onAuthChanged);
    widget.tenantDefaultLocale?.addListener(_onTenantDefaultLocaleChanged);
    unawaited(widget.auth.restore());
  }

  @override
  void didUpdateWidget(PubliraApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.tenantDefaultLocale != oldWidget.tenantDefaultLocale) {
      oldWidget.tenantDefaultLocale?.removeListener(
        _onTenantDefaultLocaleChanged,
      );
      widget.tenantDefaultLocale?.addListener(_onTenantDefaultLocaleChanged);
    }
  }

  @override
  void dispose() {
    widget.tenantDefaultLocale?.removeListener(_onTenantDefaultLocaleChanged);
    widget.auth.removeListener(_onAuthChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// The reader changed the device's language while the app was running, so
  /// the next frame renders in whatever it now asks for.
  @override
  void didChangeLocales(List<Locale>? locales) {
    setState(() {});
  }

  void _onTenantDefaultLocaleChanged() {
    setState(() {});
  }

  /// The locale every screen renders in, decided from the device's languages
  /// and what the tenant lookup has answered so far.
  Locale get _locale => resolveAppLocale(
    deviceLocales: WidgetsBinding.instance.platformDispatcher.locales,
    tenantDefaultLocale: widget.tenantDefaultLocale?.value,
  );

  /// Tells the reader once when a session the app had stored turned out to be
  /// gone, and offers the way back in rather than signing them in silently.
  void _onAuthChanged() {
    if (!widget.auth.acknowledgeExpiry()) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // The messenger sits above `Localizations`, so its context cannot answer
      // for the copy; the catalog is picked the way the frame was.
      final messages = AppMessages.forLocale(_locale);
      if (messages == null) {
        return;
      }
      _messengerKey.currentState?.showSnackBar(
        SnackBar(
          content: Text(messages.errorsRpcUnauthenticated),
          action: SnackBarAction(
            label: messages.commonSignIn,
            onPressed: () => widget.router.push(AppRoutes.signIn),
          ),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return AuthScope(
      controller: widget.auth,
      child: OfflineScope(
        library: widget.offline,
        child: CatalogScope(
          repository: widget.catalog,
          child: MaterialApp.router(
            title: 'Publira',
            scaffoldMessengerKey: _messengerKey,
            locale: _locale,
            supportedLocales: AppMessages.supportedLocales,
            localizationsDelegates: appLocalizationsDelegates,
            theme: ThemeData(
              colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
              useMaterial3: true,
            ),
            routerConfig: widget.router,
          ),
        ),
      ),
    );
  }
}
