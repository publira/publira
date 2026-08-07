import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/router.dart';

/// Root widget. Accepts an optional [router] so tests can inject a fresh
/// [GoRouter] instance.
class PubliraApp extends StatelessWidget {
  PubliraApp({super.key, GoRouter? router})
    : _router = router ?? createAppRouter();

  final GoRouter _router;

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Publira',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      routerConfig: _router,
    );
  }
}
