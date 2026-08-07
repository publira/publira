import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/router.dart';

/// Fallback when no route matches the requested location.
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key, required this.uri});

  final Uri uri;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ページが見つかりません')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('「$uri」は存在しません。'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => context.go(AppRoutes.catalog),
              child: const Text('カタログへ戻る'),
            ),
          ],
        ),
      ),
    );
  }
}
