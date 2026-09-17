import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/http_auth_repository.dart';
import 'package:publira/auth/session_store.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/http_catalog_repository.dart';
import 'package:publira/comments/comment_repository.dart';
import 'package:publira/comments/http_comment_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/follow/http_follow_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/locale_negotiation.dart';
import 'package:publira/l10n/localizations.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/links/incoming_links.dart';
import 'package:publira/links/link_scope.dart';
import 'package:publira/links/share_sheet.dart';
import 'package:publira/offline/file_offline_library.dart';
import 'package:publira/offline/offline_catalog_repository.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/offline_scope.dart';
import 'package:publira/purchase/checkout_launcher.dart';
import 'package:publira/purchase/http_purchase_repository.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/push/http_push_repository.dart';
import 'package:publira/push/push_controller.dart';
import 'package:publira/push/push_device_store.dart';
import 'package:publira/push/push_messaging.dart';
import 'package:publira/push/push_scope.dart';
import 'package:publira/router.dart';
import 'package:publira/settings/age_rating_confirmation.dart';
import 'package:publira/tenant/tenant_brand.dart';
import 'package:publira/tenant/tenant_brand_controller.dart';
import 'package:publira/tenant/tenant_brand_repository.dart';
import 'package:publira/tenant/tenant_theme.dart';

/// Root widget. Accepts [router], [catalog], and [auth] so tests can inject a
/// fresh [GoRouter], a fake or fixture-backed catalog, and a session that does
/// not touch the platform keychain.
class PubliraApp extends StatefulWidget {
  const PubliraApp({
    super.key,
    required this.router,
    required this.catalog,
    required this.auth,
    this.comments,
    this.follows,
    this.purchases,
    this.checkoutLauncher,
    this.offline,
    this.push,
    this.ageRatingConfirmation,
    this.tenantDefaultLocale,
    this.site,
    this.incomingLinks,
    this.share,
    this.tenantBrand,
  });

  /// Wires the app to the public API described by [config].
  ///
  /// One [ConnectClient] serves the catalog and the auth calls alike, so every
  /// request carries whichever token the reader is signed in with, and one
  /// [TenantResolver] means the tenant is looked up once per run. [store] is
  /// the session's home, which an on-device test replaces so it does not carry
  /// a session from one test to the next.
  ///
  /// [offline] is what the device keeps for reading without a network, which
  /// an on-device test replaces so it does not carry saved episodes from one
  /// test to the next.
  ///
  /// [checkoutLauncher] opens a checkout page, which an on-device test
  /// replaces so a purchase does not leave the app for a real browser.
  ///
  /// [messaging] is the device's notification service, which `main` resolves
  /// before the first frame because initializing Firebase is asynchronous. It
  /// is `null` for a build carrying no Firebase project, and push is off then.
  factory PubliraApp.fromConfig({
    Key? key,
    AppConfig? config,
    GoRouter? router,
    SessionStore store = const SecureSessionStore(),
    OfflineLibrary? offline,
    PushMessaging? messaging,
    PushDeviceStore pushDevices = const SecurePushDeviceStore(),
    AgeRatingConfirmationStore ageRatingConfirmation =
        const FileAgeRatingConfirmationStore(),
    IncomingLinks? incomingLinks,
    ShareSheet? share,
    CheckoutLauncher? checkoutLauncher,
  }) {
    final resolved = config ?? AppConfig.fromEnvironment();
    final library =
        offline ?? FileOfflineLibrary(tenantHost: resolved.tenantHost);
    late final AuthController auth;
    final client = ConnectClient(
      baseUrl: resolved.apiBaseUrl,
      accessToken: () => auth.accessToken,
    );
    final tenants = TenantResolver(
      client: client,
      tenantHost: resolved.tenantHost,
    );
    auth = AuthController(
      repository: HttpAuthRepository(
        config: resolved,
        client: client,
        tenants: tenants,
      ),
      store: store,
    );
    return PubliraApp(
      key: key,
      router: router ?? createAppRouter(),
      catalog: OfflineCatalogRepository(
        origin: HttpCatalogRepository(
          config: resolved,
          client: client,
          tenants: tenants,
        ),
        library: library,
        readerId: () => auth.session?.userPublicId ?? '',
        imageRequestHeaders: resolved.publicImageRequestHeaders,
      ),
      auth: auth,
      comments: HttpCommentRepository(client: client, tenants: tenants),
      follows: HttpFollowRepository(client: client, tenants: tenants),
      purchases: HttpPurchaseRepository(client: client, tenants: tenants),
      checkoutLauncher: checkoutLauncher ?? const PluginCheckoutLauncher(),
      offline: library,
      push: PushController(
        messaging: messaging,
        repository: HttpPushRepository(client: client, tenants: tenants),
        store: pushDevices,
      ),
      ageRatingConfirmation: AgeRatingConfirmationController(
        store: ageRatingConfirmation,
      ),
      tenantDefaultLocale: tenants.defaultLocale,
      site: PublicSite(host: resolved.tenantHost),
      incomingLinks: incomingLinks ?? PluginIncomingLinks(),
      share: share ?? const PluginShareSheet(),
      tenantBrand: TenantBrandController(
        repository: HttpTenantBrandRepository(
          config: resolved,
          client: client,
          tenants: tenants,
        ),
        tenantHost: resolved.tenantHost,
        library: library,
        logoRequestHeaders: resolved.publicImageRequestHeaders,
      ),
    );
  }

  final GoRouter router;
  final CatalogRepository catalog;
  final AuthController auth;

  /// The reader comments on an episode.
  ///
  /// [PubliraApp.fromConfig] always supplies one. It is nullable for the
  /// direct constructor, which a widget test uses to build the app with no
  /// comments at all, and the end of an episode then offers none.
  final CommentRepository? comments;

  /// The series and authors the reader follows.
  ///
  /// [PubliraApp.fromConfig] always supplies one. It is nullable for the
  /// direct constructor, which a widget test uses to build the app with no
  /// follows at all, and no screen then offers to follow anything.
  final FollowRepository? follows;

  /// Paid-episode checkout, and [checkoutLauncher] the page is opened with.
  ///
  /// [PubliraApp.fromConfig] always supplies both. They are nullable for the
  /// direct constructor, which a widget test uses to build the app with no
  /// purchase at all, and a locked episode then offers none.
  final PurchaseRepository? purchases;
  final CheckoutLauncher? checkoutLauncher;

  /// What the device holds for reading without a network.
  ///
  /// [PubliraApp.fromConfig] always supplies one, and it is that library which
  /// decides at runtime whether the platform can keep anything. It is nullable
  /// for the direct constructor, which a widget test uses to build the app
  /// with no offline behaviour at all.
  final OfflineLibrary? offline;

  /// The new-episode notifications the reader can turn on.
  ///
  /// [PubliraApp.fromConfig] always supplies one, and the controller itself
  /// decides whether this build can deliver anything. It is nullable for the
  /// direct constructor, which a widget test uses to build the app with no
  /// notification behaviour at all.
  final PushController? push;

  /// The age rating this install has confirmed, which a rated series or
  /// episode asks before opening.
  ///
  /// [PubliraApp.fromConfig] always supplies one. It is nullable for the
  /// direct constructor, which a widget test uses to start unconfirmed, or
  /// to inject a store that is already confirmed.
  final AgeRatingConfirmationController? ageRatingConfirmation;

  /// The tenant's default locale code, once the tenant lookup has learnt it.
  ///
  /// [PubliraApp.fromConfig] hands over what its [TenantResolver] reports; a
  /// widget test passes a [ValueNotifier] to act the answer out, or nothing,
  /// in which case only the device's own languages decide the locale.
  final ValueListenable<String?>? tenantDefaultLocale;

  /// The tenant site a share names and an incoming link is accepted from.
  ///
  /// [PubliraApp.fromConfig] always supplies one. It is nullable for the
  /// direct constructor, which a widget test uses when it is not exercising
  /// links or sharing.
  final PublicSite? site;

  /// Tenant URLs the OS hands the app.
  ///
  /// [PubliraApp.fromConfig] always supplies one. It is nullable for the
  /// direct constructor, which a widget test uses to build the app with no
  /// incoming links, or to inject a stream it writes itself.
  final IncomingLinks? incomingLinks;

  /// The platform share sheet a series or an episode is handed to.
  ///
  /// [PubliraApp.fromConfig] always supplies one. It is nullable for the
  /// direct constructor, which a widget test uses to build the app with no
  /// share action, or to inject a sheet it can assert against.
  final ShareSheet? share;

  /// The name, colours, and logo of the tenant the app was built for.
  ///
  /// [PubliraApp.fromConfig] always supplies one. It is nullable for the
  /// direct constructor, which a widget test uses to build the app in the
  /// brand defaults with no tenant name.
  final TenantBrandController? tenantBrand;

  @override
  State<PubliraApp> createState() => _PubliraAppState();
}

class _PubliraAppState extends State<PubliraApp> with WidgetsBindingObserver {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();

  /// What the reader's session was the last time [_onAuthChanged] looked, so a
  /// sign-in and a sign-out can be told apart from the other changes the
  /// controller reports.
  late bool _wasSignedIn;

  /// The confirmation this run owns when the widget did not pass one, so a
  /// widget test that does not care about ratings still has a store.
  AgeRatingConfirmationController? _ownedAgeRating;
  late AgeRatingConfirmationController _ageRating;

  StreamSubscription<Uri>? _incomingLinks;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _wasSignedIn = widget.auth.isSignedIn;
    final passed = widget.ageRatingConfirmation;
    if (passed != null) {
      _ageRating = passed;
    } else {
      _ownedAgeRating = AgeRatingConfirmationController();
      _ageRating = _ownedAgeRating!;
    }
    widget.auth.addListener(_onAuthChanged);
    widget.push?.addListener(_onPushChanged);
    widget.tenantDefaultLocale?.addListener(_onTenantDefaultLocaleChanged);
    widget.tenantBrand?.addListener(_onTenantBrandChanged);
    unawaited(_restore());
    unawaited(widget.tenantBrand?.start());
  }

  /// Brings the device's notification registration back before the session.
  ///
  /// Both are asynchronous, and restoring the session is what reports the
  /// sign-in that re-registers the device. Started together, a session that
  /// came back first would report it while the controller still held no token,
  /// and nothing would register: the sign-in is reported once, and starting the
  /// controller is not a second one. Restoring the token first is what makes
  /// the two orders the same.
  Future<void> _restore() async {
    await widget.push?.start();
    await _listenForLinks();
    await Future.wait([widget.auth.restore(), _ageRating.restore()]);
  }

  /// Opens the tenant URL that launched the app, then listens for ones that
  /// arrive while it is already running.
  ///
  /// A platform that cannot hand links over is not a failure of the rest of
  /// the launch: sharing and in-app navigation still work, and only arriving
  /// from a tenant URL does not.
  Future<void> _listenForLinks() async {
    final links = widget.incomingLinks;
    if (links == null) {
      return;
    }
    _incomingLinks = links.changes.listen(_openLink, onError: (Object _) {});
    try {
      final initial = await links.initial;
      if (mounted && initial != null) {
        _openLink(initial);
      }
    } on Exception {
      // The initial platform lookup failed. Runtime links can still arrive.
    }
  }

  void _openLink(Uri uri) {
    final host = widget.site?.host;
    if (host == null) {
      return;
    }
    final location = appLocationFor(uri, tenantHost: host);
    if (location == null) {
      return;
    }
    widget.router.go(location);
  }

  @override
  void didUpdateWidget(PubliraApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.tenantDefaultLocale != oldWidget.tenantDefaultLocale) {
      oldWidget.tenantDefaultLocale?.removeListener(
        _onTenantDefaultLocaleChanged,
      );
      widget.tenantDefaultLocale?.addListener(_onTenantDefaultLocaleChanged);
    }
    if (widget.tenantBrand != oldWidget.tenantBrand) {
      oldWidget.tenantBrand?.removeListener(_onTenantBrandChanged);
      widget.tenantBrand?.addListener(_onTenantBrandChanged);
      unawaited(widget.tenantBrand?.start());
    }
  }

  @override
  void dispose() {
    widget.tenantBrand?.removeListener(_onTenantBrandChanged);
    widget.tenantDefaultLocale?.removeListener(_onTenantDefaultLocaleChanged);
    widget.push?.removeListener(_onPushChanged);
    widget.auth.removeListener(_onAuthChanged);
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_incomingLinks?.cancel());
    _ownedAgeRating?.dispose();
    super.dispose();
  }

  /// The reader changed the device's language while the app was running, so
  /// the next frame renders in whatever it now asks for.
  @override
  void didChangeLocales(List<Locale>? locales) {
    setState(() {});
  }

  void _onTenantDefaultLocaleChanged() {
    setState(() {});
  }

  /// The tenant's colours and name arrived, off the device or from the API.
  void _onTenantBrandChanged() {
    setState(() {});
  }

  /// The locale every screen renders in, decided from the device's languages
  /// and what the tenant lookup has answered so far.
  Locale get _locale => resolveAppLocale(
    deviceLocales: WidgetsBinding.instance.platformDispatcher.locales,
    tenantDefaultLocale: widget.tenantDefaultLocale?.value,
  );

  /// Keeps the device's notification registration in step with the reader who
  /// holds the session, and tells the reader once when a session the app had
  /// stored turned out to be gone, offering the way back in rather than
  /// signing them in silently.
  void _onAuthChanged() {
    final signedIn = widget.auth.isSignedIn;
    if (signedIn != _wasSignedIn) {
      _wasSignedIn = signedIn;
      // A deliberate sign-out has already unregistered, while the session was
      // still good; this covers the one the app ends itself. Both are the same
      // idempotent call.
      unawaited(
        signedIn ? widget.push?.handleSignedIn() : widget.push?.handleSignOut(),
      );
    }
    if (!widget.auth.acknowledgeExpiry()) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // The messenger sits above `Localizations`, so its context cannot answer
      // for the copy; the catalog is picked the way the frame was.
      final messages = AppMessages.forLocale(_locale);
      if (messages == null) {
        return;
      }
      _messengerKey.currentState?.showSnackBar(
        SnackBar(
          content: Text(messages.errorsRpcUnauthenticated),
          action: SnackBarAction(
            label: messages.commonSignIn,
            onPressed: () => widget.router.push(AppRoutes.signIn),
          ),
        ),
      );
    });
  }

  /// Draws a notification that arrived while the app was in front, which FCM
  /// leaves to the app, and follows a tap on one the OS drew.
  void _onPushChanged() {
    final push = widget.push;
    if (push == null) {
      return;
    }
    final route = push.acknowledgePendingRoute();
    if (route != null) {
      // A payload naming no route the app can open still opened the app, so
      // the reader lands on the catalog rather than nowhere.
      widget.router.push(route.isEmpty ? AppRoutes.catalog : route);
    }
    final message = push.acknowledgeForegroundMessage();
    if (message == null) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final messages = AppMessages.forLocale(_locale);
      if (messages == null) {
        return;
      }
      final target = message.route;
      _messengerKey.currentState?.showSnackBar(
        SnackBar(
          content: Text(
            message.body.isEmpty ? message.title : message.body,
            key: const ValueKey('push-foreground-message'),
          ),
          action: target.isEmpty
              ? null
              : SnackBarAction(
                  label: messages.pushOpen,
                  onPressed: () => widget.router.push(target),
                ),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final site = widget.site;
    final brand = widget.tenantBrand?.brand;
    Widget app = MaterialApp.router(
      title: brand?.name ?? '',
      scaffoldMessengerKey: _messengerKey,
      locale: _locale,
      supportedLocales: AppMessages.supportedLocales,
      localizationsDelegates: appLocalizationsDelegates,
      theme: tenantLightTheme(brand?.palette ?? TenantPalette.standard),
      darkTheme: tenantDarkTheme(brand?.palette ?? TenantPalette.standard),
      routerConfig: widget.router,
    );
    if (site != null) {
      app = LinkScope(
        site: PublicSite(
          host: site.host,
          defaultLocale: widget.tenantDefaultLocale?.value,
        ),
        share: widget.share,
        child: app,
      );
    }
    return TenantBrandScope(
      controller: widget.tenantBrand,
      child: AuthScope(
        controller: widget.auth,
        child: PushScope(
          controller: widget.push,
          child: OfflineScope(
            library: widget.offline,
            child: CatalogScope(
              repository: widget.catalog,
              child: CommentScope(
                repository: widget.comments,
                child: FollowScope(
                  repository: widget.follows,
                  child: PurchaseScope(
                    repository: widget.purchases,
                    launcher: widget.checkoutLauncher,
                    child: AgeRatingConfirmationScope(
                      controller: _ageRating,
                      child: app,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
