import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/notifications/notification_inbox.dart';
import 'package:publira/router.dart';

/// The destinations of the bottom navigation bar, in the order it shows them.
///
/// Each is a branch of its own with its own navigation stack, rooted at
/// [root]. The catalog's routes live under every root, so a series opened from
/// the search results is pushed onto the search tab rather than taking the
/// reader to the home tab.
enum AppTab {
  home(AppRoutes.catalog),
  search(AppRoutes.search),
  library(AppRoutes.library),
  notifications(AppRoutes.notifications),
  account(AppRoutes.account);

  const AppTab(this.root);

  final String root;

  /// The tab [context] was built in, and the home tab outside every tab.
  static AppTab of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppTabScope>()?.tab ?? home;

  /// [location] on this tab's own stack.
  ///
  /// A location only the home tab holds, such as another tab's root or where
  /// a confirmation mail lands, stays as it is.
  String locate(String location) {
    if (this == home || !isHeldByEveryTab(location)) {
      return location;
    }
    return '$root$location';
  }
}

/// Which tab a subtree was built in, and whether that tab is the one on
/// screen.
class AppTabScope extends InheritedWidget {
  const AppTabScope({
    super.key,
    required this.tab,
    required this.active,
    required super.child,
  });

  final AppTab tab;
  final bool active;

  /// Whether the tab [context] was built in is on screen; `true` outside
  /// every tab.
  static bool isActive(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppTabScope>()?.active ?? true;

  @override
  bool updateShouldNotify(AppTabScope oldWidget) =>
      tab != oldWidget.tab || active != oldWidget.active;
}

/// Navigation onto the stack of the tab a screen is on.
extension TabNavigation on BuildContext {
  /// Pushes [location] onto this tab's stack.
  Future<T?> pushInTab<T extends Object?>(String location) =>
      push<T>(AppTab.of(this).locate(location));

  /// Replaces the screen on top of this tab's stack with [location].
  void pushReplacementInTab(String location) =>
      pushReplacement(AppTab.of(this).locate(location));

  /// Replaces this tab's stack with the one [location] names.
  void goInTab(String location) => go(AppTab.of(this).locate(location));

  /// Opens [location] where it belongs: pushed onto this tab when every tab
  /// holds it, and otherwise on the tab that does.
  ///
  /// A push onto one tab's stack of a route only another tab holds would put
  /// that route on the wrong navigator, so such a location is gone to instead.
  void openInTab(String location) {
    if (isHeldByEveryTab(location)) {
      pushInTab<void>(location);
    } else {
      go(location);
    }
  }
}

/// Every tab, one of them on screen, above the bar that switches between
/// them.
///
/// The bar is left out while the episode viewer is on top, where the page
/// takes the whole screen; every other screen carries it, including the
/// comments opened from the viewer.
class AppTabShell extends StatelessWidget {
  const AppTabShell({
    super.key,
    required this.navigationShell,
    required this.children,
    required this.showsBar,
  });

  final StatefulNavigationShell navigationShell;
  final List<Widget> children;
  final bool showsBar;

  void _select(int index) {
    // The tab on screen goes back to its root, which is the one way out of a
    // stack a reader has walked deep into.
    navigationShell.goBranch(
      index,
      initialLocation: index == navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context) {
    final current = navigationShell.currentIndex;
    return Scaffold(
      body: IndexedStack(
        index: current,
        children: [
          for (final (index, child) in children.indexed)
            Offstage(
              offstage: index != current,
              child: TickerMode(
                enabled: index == current,
                // A field focused on a tab left behind would keep the keyboard
                // over the tab the reader switched to.
                child: ExcludeFocus(
                  excluding: index != current,
                  child: AppTabScope(
                    tab: AppTab.values[index],
                    active: index == current,
                    child: child,
                  ),
                ),
              ),
            ),
        ],
      ),
      bottomNavigationBar: showsBar
          ? _AppTabBar(selectedIndex: current, onSelected: _select)
          : null,
    );
  }
}

class _AppTabBar extends StatelessWidget {
  const _AppTabBar({required this.selectedIndex, required this.onSelected});

  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    final unread = signedIn
        ? NotificationScope.maybeOf(context)?.unreadCount ?? 0
        : 0;
    Widget notificationsIcon(IconData icon) => Badge(
      key: const ValueKey('tab-notifications-unread'),
      isLabelVisible: unread > 0,
      label: Text(unreadBadgeLabel(messages, unread)),
      child: Icon(icon),
    );
    return NavigationBar(
      key: const ValueKey('tab-bar'),
      selectedIndex: selectedIndex,
      onDestinationSelected: onSelected,
      destinations: [
        NavigationDestination(
          key: const ValueKey('tab-home'),
          icon: const Icon(Icons.home_outlined),
          selectedIcon: const Icon(Icons.home),
          label: messages.navigationHome,
        ),
        NavigationDestination(
          key: const ValueKey('tab-search'),
          icon: const Icon(Icons.search),
          label: messages.navigationSearch,
        ),
        NavigationDestination(
          key: const ValueKey('tab-library'),
          icon: const Icon(Icons.collections_bookmark_outlined),
          selectedIcon: const Icon(Icons.collections_bookmark),
          label: messages.navigationLibrary,
        ),
        NavigationDestination(
          key: const ValueKey('tab-notifications'),
          icon: notificationsIcon(Icons.notifications_outlined),
          selectedIcon: notificationsIcon(Icons.notifications),
          label: messages.navigationNotifications,
          tooltip: unread > 0
              ? messages.navigationNotificationsUnread(
                  count: messages.formatInteger(unread),
                )
              : null,
        ),
        NavigationDestination(
          key: const ValueKey('tab-account'),
          icon: Icon(signedIn ? Icons.person : Icons.person_outline),
          label: messages.navigationAccount,
        ),
      ],
    );
  }
}
