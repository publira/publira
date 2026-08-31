import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

/// Home / catalog list. Loads published series from [CatalogRepository].
class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  late Future<List<SeriesItem>> _future;
  var _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _future = CatalogScope.of(context).listSeries();
  }

  void _reload() {
    setState(() {
      _future = CatalogScope.of(context).listSeries();
    });
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = AuthScope.of(context).isSignedIn;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Publira'),
        actions: [
          IconButton(
            key: const ValueKey('catalog-account'),
            icon: Icon(signedIn ? Icons.person : Icons.person_outline),
            tooltip: signedIn ? 'アカウント' : 'サインイン',
            onPressed: () =>
                context.push(signedIn ? AppRoutes.account : AppRoutes.signIn),
          ),
        ],
      ),
      body: FutureBuilder<List<SeriesItem>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(
              key: ValueKey('catalog-loading'),
              child: CircularProgressIndicator(),
            );
          }
          if (snapshot.hasError) {
            return _CatalogMessage(
              key: const ValueKey('catalog-error'),
              message: _errorCopy(snapshot.error),
              actionLabel: '再試行',
              onAction: _reload,
            );
          }
          final series = snapshot.data ?? const <SeriesItem>[];
          if (series.isEmpty) {
            return const _CatalogMessage(
              key: ValueKey('catalog-empty'),
              message: '公開中のシリーズはありません',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: series.length,
            separatorBuilder: (context, index) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final item = series[index];
              return ListTile(
                key: ValueKey('series-tile-${item.id}'),
                title: Text(item.title),
                subtitle: item.description.isEmpty
                    ? null
                    : Text(
                        item.description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                trailing: item.labelName.isEmpty ? null : Text(item.labelName),
                onTap: () {
                  context.push(AppRoutes.seriesDetailPath(item.id));
                },
              );
            },
          );
        },
      ),
    );
  }

  String _errorCopy(Object? error) {
    if (error is CatalogFailure && error.kind == CatalogFailureKind.network) {
      return 'カタログを表示できませんでした。通信状況を確認して再試行してください。';
    }
    return 'カタログを表示できませんでした';
  }
}

class _CatalogMessage extends StatelessWidget {
  const _CatalogMessage({
    super.key,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              FilledButton(
                key: const ValueKey('catalog-retry'),
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
