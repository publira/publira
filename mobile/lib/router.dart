import 'package:go_router/go_router.dart';
import 'package:publira/screens/account_screen.dart';
import 'package:publira/screens/catalog_screen.dart';
import 'package:publira/screens/episode_viewer_screen.dart';
import 'package:publira/screens/not_found_screen.dart';
import 'package:publira/screens/series_detail_screen.dart';
import 'package:publira/screens/sign_in_screen.dart';

/// Route path helpers for type-safe navigation.
abstract final class AppRoutes {
  static const catalog = '/';
  static const signIn = '/sign-in';
  static const account = '/account';
  static const seriesDetail = '/series/:seriesId';
  static const episodeViewer = 'episodes/:episodeId';

  static String seriesDetailPath(String seriesId) => '/series/$seriesId';

  static String episodeViewerPath(String seriesId, String episodeId) =>
      '/series/$seriesId/episodes/$episodeId';
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
        path: AppRoutes.signIn,
        name: 'signIn',
        builder: (context, state) => const SignInScreen(),
      ),
      GoRoute(
        path: AppRoutes.account,
        name: 'account',
        builder: (context, state) => const AccountScreen(),
      ),
      GoRoute(
        path: AppRoutes.seriesDetail,
        name: 'seriesDetail',
        builder: (context, state) {
          final seriesId = state.pathParameters['seriesId']!;
          return SeriesDetailScreen(seriesId: seriesId);
        },
        // Nested so a deep link to a page opens on top of its series and the
        // back gesture lands there rather than leaving the app.
        routes: [
          GoRoute(
            path: AppRoutes.episodeViewer,
            name: 'episodeViewer',
            builder: (context, state) => EpisodeViewerScreen(
              seriesId: state.pathParameters['seriesId']!,
              episodeId: state.pathParameters['episodeId']!,
            ),
          ),
        ],
      ),
    ],
    errorBuilder: (context, state) => NotFoundScreen(uri: state.uri),
  );
}
