import 'package:go_router/go_router.dart';
import 'package:publira/screens/catalog_screen.dart';
import 'package:publira/screens/not_found_screen.dart';
import 'package:publira/screens/series_detail_screen.dart';

/// Route path helpers for type-safe navigation.
abstract final class AppRoutes {
  static const catalog = '/';
  static const seriesDetail = '/series/:seriesId';

  static String seriesDetailPath(String seriesId) => '/series/$seriesId';
}

/// Application router. Kept as a factory so widget tests can inject a fresh
/// [GoRouter] without sharing navigation state across tests.
GoRouter createAppRouter({String initialLocation = AppRoutes.catalog}) {
  return GoRouter(
    initialLocation: initialLocation,
    routes: [
      GoRoute(
        path: AppRoutes.catalog,
        name: 'catalog',
        builder: (context, state) => const CatalogScreen(),
      ),
      GoRoute(
        path: AppRoutes.seriesDetail,
        name: 'seriesDetail',
        builder: (context, state) {
          final seriesId = state.pathParameters['seriesId']!;
          return SeriesDetailScreen(seriesId: seriesId);
        },
      ),
    ],
    errorBuilder: (context, state) => NotFoundScreen(uri: state.uri),
  );
}
