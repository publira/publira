import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/http_catalog_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/router.dart';

/// Root widget. Accepts [router], [catalog], and [config] so tests can inject
/// a fresh [GoRouter] and a fake or fixture-backed catalog.
class PubliraApp extends StatelessWidget {
  PubliraApp({
    super.key,
    GoRouter? router,
    CatalogRepository? catalog,
    AppConfig? config,
  }) : _router = router ?? createAppRouter(),
       _catalog =
           catalog ??
           HttpCatalogRepository(config: config ?? AppConfig.fromEnvironment());

  final GoRouter _router;
  final CatalogRepository _catalog;

  @override
  Widget build(BuildContext context) {
    return CatalogScope(
      repository: _catalog,
      child: MaterialApp.router(
        title: 'Publira',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
          useMaterial3: true,
        ),
        routerConfig: _router,
      ),
    );
  }
}
