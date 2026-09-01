import 'dart:async';

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
    );
  }

  final GoRouter router;
  final CatalogRepository catalog;
  final AuthController auth;

  /// What the device holds for reading without a network, `null` on a run that
  /// keeps nothing.
  final OfflineLibrary? offline;

  @override
  State<PubliraApp> createState() => _PubliraAppState();
}

class _PubliraAppState extends State<PubliraApp> {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();

  @override
  void initState() {
    super.initState();
    widget.auth.addListener(_onAuthChanged);
    unawaited(widget.auth.restore());
  }

  @override
  void dispose() {
    widget.auth.removeListener(_onAuthChanged);
    super.dispose();
  }

  /// Tells the reader once when a session the app had stored turned out to be
  /// gone, and offers the way back in rather than signing them in silently.
  void _onAuthChanged() {
    if (!widget.auth.acknowledgeExpiry()) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _messengerKey.currentState?.showSnackBar(
        SnackBar(
          content: const Text('サインインの有効期限が切れました'),
          action: SnackBarAction(
            label: 'サインイン',
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
