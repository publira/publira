import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/screens/account_screen.dart';
import 'package:publira/screens/catalog_screen.dart';
import 'package:publira/screens/checkout_return_screen.dart';
import 'package:publira/screens/creator_screen.dart';
import 'package:publira/screens/downloads_screen.dart';
import 'package:publira/screens/episode_comments_screen.dart';
import 'package:publira/screens/episode_viewer_screen.dart';
import 'package:publira/screens/follows_screen.dart';
import 'package:publira/screens/label_screen.dart';
import 'package:publira/screens/not_found_screen.dart';
import 'package:publira/screens/search_screen.dart';
import 'package:publira/screens/series_detail_screen.dart';
import 'package:publira/screens/sign_in_screen.dart';

/// Route path helpers for type-safe navigation.
abstract final class AppRoutes {
  static const catalog = '/';
  static const search = '/search';
  static const signIn = '/sign-in';
  static const account = '/account';
  static const follows = 'follows';
  static const accountFollows = '$account/$follows';
  static const downloads = 'downloads';
  static const accountDownloads = '$account/$downloads';
  static const seriesDetail = '/series/:seriesId';
  static const creatorDetail = '/creators/:creatorId';
  static const labelDetail = '/labels/:labelId';
  static const episodeViewer = 'episodes/:episodeId';
  static const episodeComments = 'comments';
  static const checkoutReturn = '/checkout/return';

  /// The sign-in form, landing on [returnTo] once the reader is in rather
  /// than on the screen that sent them.
  static String signInPath({String? returnTo}) => returnTo == null
      ? signIn
      : Uri(path: signIn, queryParameters: {'return_to': returnTo}).toString();

  static String seriesDetailPath(String seriesId) => '/series/$seriesId';

  static String creatorDetailPath(String creatorId) => '/creators/$creatorId';

  static String labelDetailPath(String labelId) => '/labels/$labelId';

  /// The viewer, told how a checkout of the episode ended when the browser
  /// has just handed one back.
  static String episodeViewerPath(
    String seriesId,
    String episodeId, {
    CheckoutOutcome? checkout,
  }) {
    final path = '/series/$seriesId/episodes/$episodeId';
    return checkout == null
        ? path
        : Uri(
            path: path,
            queryParameters: {'checkout': checkout.wireName},
          ).toString();
  }

  static String episodeCommentsPath(String seriesId, String episodeId) =>
      '${episodeViewerPath(seriesId, episodeId)}/comments';
}

/// Application router. Kept as a factory so widget tests can inject a fresh
/// [GoRouter] without sharing navigation state across tests.
///
/// With no [initialLocation], the app opens on the route it was launched
/// with: the `route` extra of an Android intent, or the fragment of a web URL.
GoRouter createAppRouter({String? initialLocation}) {
  return GoRouter(
    initialLocation:
        initialLocation ??
        launchLocation(
          WidgetsBinding.instance.platformDispatcher.defaultRouteName,
        ),
    // Incoming tenant URLs are parsed by `app_links` and handed over as
    // in-app paths, so the platform's raw `https://…` location is never
    // matched against these routes.
    overridePlatformDefaultLocation: true,
    routes: [
      GoRoute(
        path: AppRoutes.catalog,
        name: 'catalog',
        builder: (context, state) => const CatalogScreen(),
      ),
      GoRoute(
        path: AppRoutes.search,
        name: 'search',
        builder: (context, state) => const SearchScreen(),
      ),
      GoRoute(
        path: AppRoutes.signIn,
        name: 'signIn',
        builder: (context, state) => SignInScreen(
          returnTo: inAppLocation(state.uri.queryParameters['return_to']),
        ),
      ),
      GoRoute(
        path: AppRoutes.checkoutReturn,
        name: 'checkoutReturn',
        // The return URL names the episode alone, so a link without one has
        // nothing to open.
        redirect: (_, state) =>
            (state.uri.queryParameters['episode'] ?? '').isEmpty
            ? AppRoutes.catalog
            : null,
        builder: (context, state) => CheckoutReturnScreen(
          episodeId: state.uri.queryParameters['episode']!,
          outcome: CheckoutOutcome.fromWire(
            state.uri.queryParameters['status'],
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.account,
        name: 'account',
        builder: (context, state) => const AccountScreen(),
        // Nested so going back from the list lands on the account screen it
        // was opened from rather than out of the app.
        routes: [
          GoRoute(
            path: AppRoutes.follows,
            name: 'follows',
            builder: (context, state) => const FollowsScreen(),
          ),
          GoRoute(
            path: AppRoutes.downloads,
            name: 'downloads',
            builder: (context, state) => const DownloadsScreen(),
          ),
        ],
      ),
      GoRoute(
        path: AppRoutes.creatorDetail,
        name: 'creatorDetail',
        builder: (context, state) =>
            CreatorScreen(creatorId: state.pathParameters['creatorId']!),
      ),
      GoRoute(
        path: AppRoutes.labelDetail,
        name: 'labelDetail',
        builder: (context, state) =>
            LabelScreen(labelId: state.pathParameters['labelId']!),
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
              checkout: CheckoutOutcome.fromWire(
                state.uri.queryParameters['checkout'],
              ),
            ),
            // Nested for the same reason the viewer is nested under its
            // series: the comments are read once the episode has been, and
            // going back from them lands on the episode rather than out.
            routes: [
              GoRoute(
                path: AppRoutes.episodeComments,
                name: 'episodeComments',
                builder: (context, state) => EpisodeCommentsScreen(
                  seriesId: state.pathParameters['seriesId']!,
                  episodeId: state.pathParameters['episodeId']!,
                ),
              ),
            ],
          ),
        ],
      ),
    ],
    errorBuilder: (context, state) => NotFoundScreen(uri: state.uri),
  );
}

/// [location] when it is a path inside this app, and `null` otherwise, so a
/// query parameter cannot send the reader to another origin.
String? inAppLocation(String? location) {
  if (location == null ||
      !location.startsWith('/') ||
      location.startsWith('//')) {
    return null;
  }
  return location;
}

/// Where a launch on [defaultRouteName] opens: that route when it is a path
/// inside this app, and the catalog otherwise, such as for a tenant link's
/// raw URL.
String launchLocation(String defaultRouteName) =>
    inAppLocation(defaultRouteName) ?? AppRoutes.catalog;
