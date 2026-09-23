import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/screens/account_screen.dart';
import 'package:publira/screens/announcement_screen.dart';
import 'package:publira/screens/announcements_screen.dart';
import 'package:publira/screens/catalog_screen.dart';
import 'package:publira/screens/change_email_screen.dart';
import 'package:publira/screens/change_password_screen.dart';
import 'package:publira/screens/checkout_return_screen.dart';
import 'package:publira/screens/confirm_email_screen.dart';
import 'package:publira/screens/confirm_password_screen.dart';
import 'package:publira/screens/contact_screen.dart';
import 'package:publira/screens/creator_screen.dart';
import 'package:publira/screens/delete_account_screen.dart';
import 'package:publira/screens/edit_name_screen.dart';
import 'package:publira/screens/episode_comments_screen.dart';
import 'package:publira/screens/episode_viewer_screen.dart';
import 'package:publira/screens/label_screen.dart';
import 'package:publira/screens/library_screen.dart';
import 'package:publira/screens/not_found_screen.dart';
import 'package:publira/screens/notifications_screen.dart';
import 'package:publira/screens/published_page_screen.dart';
import 'package:publira/screens/resend_verification_screen.dart';
import 'package:publira/screens/reset_password_screen.dart';
import 'package:publira/screens/search_screen.dart';
import 'package:publira/screens/series_detail_screen.dart';
import 'package:publira/screens/sign_in_screen.dart';
import 'package:publira/screens/sign_up_screen.dart';
import 'package:publira/screens/verify_email_screen.dart';

/// Route path helpers for type-safe navigation.
abstract final class AppRoutes {
  static const catalog = '/';
  static const search = '/search';
  static const library = '/library';
  static const notifications = '/notifications';
  static const signIn = '/sign-in';
  static const signUp = '/sign-up';

  /// The path the site's confirmation mail links to, which this app claims
  /// as an App Link, so the token is spent here rather than in a browser.
  static const verifyEmail = '/verify';
  static const resendVerification = '/resend-verification';

  /// The site's own paths for asking for a password reset link and for the
  /// link itself, both claimed as App Links so neither opens a browser.
  static const resetPassword = '/reset-password';
  static const confirmPassword = '/confirm-password';

  /// The site's path for either link of an email change, claimed as an App
  /// Link like the other account mails.
  static const confirmEmail = '/confirm-email';
  static const account = '/account';
  static const name = 'name';
  static const accountName = '$account/$name';
  static const email = 'email';
  static const accountEmail = '$account/$email';
  static const password = 'password';
  static const accountPassword = '$account/$password';
  static const delete = 'delete';
  static const accountDelete = '$account/$delete';
  static const contact = 'contact';
  static const accountContact = '$account/$contact';

  /// The catalog's routes, which every tab holds under its own root.
  static const seriesDetail = 'series/:seriesId';
  static const creatorDetail = 'creators/:creatorId';
  static const labelDetail = 'labels/:labelId';
  static const episodeViewer = 'episodes/:episodeId';
  static const episodeComments = 'comments';
  static const checkoutReturn = '/checkout/return';

  /// The site's own path for the announcements, claimed as an App Link, and
  /// one announcement under it, which the site shows inline instead.
  static const announcements = '/announcements';
  static const announcementDetail = ':announcementId';

  static String announcementPath(String announcementId) =>
      '$announcements/${Uri.encodeComponent(announcementId)}';

  /// A page the tenant published, which the site serves at its slug and this
  /// app keeps under one prefix of its own, so no slug can shadow a screen.
  static const publishedPage = 'page/:pageSlug';

  /// The page published at [slug], in storage form (`/legal/terms`). The slug
  /// is one encoded segment, since go_router matches no more than one.
  static String publishedPagePath(String slug) =>
      '/page/${Uri.encodeComponent(slug.startsWith('/') ? slug.substring(1) : slug)}';

  /// The resend form, with [email] already in its field for a reader sent
  /// from a form that knows the address.
  static String resendVerificationPath({String? email}) =>
      email == null || email.isEmpty
      ? resendVerification
      : Uri(
          path: resendVerification,
          queryParameters: {'email': email},
        ).toString();

  /// The reset request form, with [email] already in its field for a reader
  /// sent from a form that knows the address.
  static String resetPasswordPath({String? email}) =>
      email == null || email.isEmpty
      ? resetPassword
      : Uri(path: resetPassword, queryParameters: {'email': email}).toString();

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

/// The metadata key that says whether a route shows the bottom navigation
/// bar. A route inherits its parent's answer unless it gives its own.
const _showsTabBar = 'showsTabBar';

/// [path] as a child of a tab's root, which go_router writes without the
/// leading slash.
String _child(String path) => path.substring(1);

/// The routes every tab holds under its own root, so a series, an author, a
/// label, or an announcement opened from a tab is pushed onto that tab's
/// stack, and so are the sign-in forms any screen can send a guest to.
///
/// Built afresh for each tab: a route belongs to one place in the tree.
List<RouteBase> _tabRoutes() => [
  GoRoute(
    path: _child(AppRoutes.signIn),
    builder: (context, state) => SignInScreen(
      returnTo: inAppLocation(state.uri.queryParameters['return_to']),
    ),
  ),
  GoRoute(
    path: _child(AppRoutes.signUp),
    builder: (context, state) => const SignUpScreen(),
  ),
  GoRoute(
    path: _child(AppRoutes.resendVerification),
    builder: (context, state) =>
        ResendVerificationScreen(email: state.uri.queryParameters['email']),
  ),
  GoRoute(
    path: _child(AppRoutes.resetPassword),
    builder: (context, state) =>
        ResetPasswordScreen(email: state.uri.queryParameters['email']),
  ),
  GoRoute(
    path: _child(AppRoutes.announcements),
    builder: (context, state) => const AnnouncementsScreen(),
    // Nested so going back from an announcement lands on the list, even
    // when the banner or a notification opened it.
    routes: [
      GoRoute(
        path: AppRoutes.announcementDetail,
        builder: (context, state) => AnnouncementScreen(
          announcementId: state.pathParameters['announcementId']!,
        ),
      ),
    ],
  ),
  GoRoute(
    path: AppRoutes.publishedPage,
    builder: (context, state) =>
        PublishedPageScreen(slug: '/${state.pathParameters['pageSlug']!}'),
  ),
  GoRoute(
    path: AppRoutes.creatorDetail,
    builder: (context, state) =>
        CreatorScreen(creatorId: state.pathParameters['creatorId']!),
  ),
  GoRoute(
    path: AppRoutes.labelDetail,
    builder: (context, state) =>
        LabelScreen(labelId: state.pathParameters['labelId']!),
  ),
  GoRoute(
    path: AppRoutes.seriesDetail,
    builder: (context, state) {
      final seriesId = state.pathParameters['seriesId']!;
      return SeriesDetailScreen(seriesId: seriesId);
    },
    // Nested so a deep link to a page opens on top of its series and the
    // back gesture lands there rather than leaving the app.
    routes: [
      GoRoute(
        path: AppRoutes.episodeViewer,
        // The page takes the whole screen.
        metadata: const {_showsTabBar: false},
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
            metadata: const {_showsTabBar: true},
            builder: (context, state) => EpisodeCommentsScreen(
              seriesId: state.pathParameters['seriesId']!,
              episodeId: state.pathParameters['episodeId']!,
            ),
          ),
        ],
      ),
    ],
  ),
];

/// The first path segment of every route [_tabRoutes] puts under a root.
final _tabRouteSegments = {
  for (final route in _tabRoutes()) (route as GoRoute).path.split('/').first,
};

/// Whether every tab holds [location] under its own root, which is what lets
/// a screen push it onto the tab it is on.
bool isHeldByEveryTab(String location) =>
    _tabRouteSegments.contains(Uri.parse(location).pathSegments.firstOrNull);

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
      StatefulShellRoute(
        builder: (context, state, navigationShell) => navigationShell,
        navigatorContainerBuilder: (context, navigationShell, children) =>
            AppTabShell(
              navigationShell: navigationShell,
              showsBar:
                  GoRouter.of(context).state.metadata[_showsTabBar] != false,
              children: children,
            ),
        // In the order of [AppTab].
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.catalog,
                name: 'catalog',
                builder: (context, state) => const CatalogScreen(),
                // The home tab's routes are the paths the tenant's site links
                // to, which is why a link to a work lands here.
                routes: [
                  ..._tabRoutes(),
                  GoRoute(
                    path: _child(AppRoutes.checkoutReturn),
                    // The return URL names the episode alone, so a link
                    // without one has nothing to open.
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
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.search,
                builder: (context, state) => const SearchScreen(),
                routes: _tabRoutes(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.library,
                builder: (context, state) => const LibraryScreen(),
                routes: _tabRoutes(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.notifications,
                builder: (context, state) => const NotificationsScreen(),
                routes: _tabRoutes(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.account,
                builder: (context, state) => const AccountScreen(),
                routes: [
                  GoRoute(
                    path: AppRoutes.name,
                    builder: (context, state) =>
                        const ReaderKeyed(child: EditNameScreen()),
                  ),
                  GoRoute(
                    path: AppRoutes.email,
                    builder: (context, state) =>
                        const ReaderKeyed(child: ChangeEmailScreen()),
                  ),
                  GoRoute(
                    path: AppRoutes.password,
                    builder: (context, state) =>
                        const ReaderKeyed(child: ChangePasswordScreen()),
                  ),
                  GoRoute(
                    path: AppRoutes.delete,
                    builder: (context, state) =>
                        const ReaderKeyed(child: DeleteAccountScreen()),
                  ),
                  GoRoute(
                    path: AppRoutes.contact,
                    builder: (context, state) => const ContactScreen(),
                  ),
                  ..._tabRoutes(),
                ],
              ),
              // Where the account mails land. They are the account tab's, so
              // leaving one for the account screen drops the spent link from
              // the stack rather than leaving it on another tab's.
              GoRoute(
                path: AppRoutes.verifyEmail,
                builder: (context, state) => VerifyEmailScreen(
                  token: state.uri.queryParameters['token'] ?? '',
                ),
              ),
              GoRoute(
                path: AppRoutes.confirmPassword,
                builder: (context, state) => ConfirmPasswordScreen(
                  token: state.uri.queryParameters['token'] ?? '',
                ),
              ),
              GoRoute(
                path: AppRoutes.confirmEmail,
                builder: (context, state) => ConfirmEmailScreen(
                  token: state.uri.queryParameters['token'] ?? '',
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
