import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/screens/account_screen.dart';
import 'package:publira/screens/catalog_screen.dart';
import 'package:publira/screens/change_email_screen.dart';
import 'package:publira/screens/change_password_screen.dart';
import 'package:publira/screens/checkout_return_screen.dart';
import 'package:publira/screens/confirm_email_screen.dart';
import 'package:publira/screens/confirm_password_screen.dart';
import 'package:publira/screens/contact_screen.dart';
import 'package:publira/screens/creator_screen.dart';
import 'package:publira/screens/delete_account_screen.dart';
import 'package:publira/screens/downloads_screen.dart';
import 'package:publira/screens/edit_name_screen.dart';
import 'package:publira/screens/episode_comments_screen.dart';
import 'package:publira/screens/episode_viewer_screen.dart';
import 'package:publira/screens/follows_screen.dart';
import 'package:publira/screens/label_screen.dart';
import 'package:publira/screens/not_found_screen.dart';
import 'package:publira/screens/notifications_screen.dart';
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
  static const notifications = 'notifications';
  static const accountNotifications = '$account/$notifications';
  static const follows = 'follows';
  static const accountFollows = '$account/$follows';
  static const downloads = 'downloads';
  static const accountDownloads = '$account/$downloads';
  static const contact = 'contact';
  static const accountContact = '$account/$contact';
  static const seriesDetail = '/series/:seriesId';
  static const creatorDetail = '/creators/:creatorId';
  static const labelDetail = '/labels/:labelId';
  static const episodeViewer = 'episodes/:episodeId';
  static const episodeComments = 'comments';
  static const checkoutReturn = '/checkout/return';

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
        path: AppRoutes.signUp,
        name: 'signUp',
        builder: (context, state) => const SignUpScreen(),
      ),
      GoRoute(
        path: AppRoutes.verifyEmail,
        name: 'verifyEmail',
        builder: (context, state) =>
            VerifyEmailScreen(token: state.uri.queryParameters['token'] ?? ''),
      ),
      GoRoute(
        path: AppRoutes.resendVerification,
        name: 'resendVerification',
        builder: (context, state) =>
            ResendVerificationScreen(email: state.uri.queryParameters['email']),
      ),
      GoRoute(
        path: AppRoutes.resetPassword,
        name: 'resetPassword',
        builder: (context, state) =>
            ResetPasswordScreen(email: state.uri.queryParameters['email']),
      ),
      GoRoute(
        path: AppRoutes.confirmPassword,
        name: 'confirmPassword',
        builder: (context, state) => ConfirmPasswordScreen(
          token: state.uri.queryParameters['token'] ?? '',
        ),
      ),
      GoRoute(
        path: AppRoutes.confirmEmail,
        name: 'confirmEmail',
        builder: (context, state) =>
            ConfirmEmailScreen(token: state.uri.queryParameters['token'] ?? ''),
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
            path: AppRoutes.name,
            name: 'accountName',
            builder: (context, state) =>
                const ReaderKeyed(child: EditNameScreen()),
          ),
          GoRoute(
            path: AppRoutes.email,
            name: 'accountEmail',
            builder: (context, state) =>
                const ReaderKeyed(child: ChangeEmailScreen()),
          ),
          GoRoute(
            path: AppRoutes.password,
            name: 'accountPassword',
            builder: (context, state) =>
                const ReaderKeyed(child: ChangePasswordScreen()),
          ),
          GoRoute(
            path: AppRoutes.delete,
            name: 'accountDelete',
            builder: (context, state) =>
                const ReaderKeyed(child: DeleteAccountScreen()),
          ),
          GoRoute(
            path: AppRoutes.notifications,
            name: 'notifications',
            builder: (context, state) => const NotificationsScreen(),
          ),
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
          GoRoute(
            path: AppRoutes.contact,
            name: 'contact',
            builder: (context, state) => const ContactScreen(),
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
