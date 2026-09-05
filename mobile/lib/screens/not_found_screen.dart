import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/router.dart';

/// Fallback when no route matches the requested location.
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key, required this.uri});

  final Uri uri;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(messages.notFoundTitle)),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(messages.notFoundMessage(uri: uri.toString())),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => context.go(AppRoutes.catalog),
              child: Text(messages.commonBackToCatalog),
            ),
          ],
        ),
      ),
    );
  }
}
