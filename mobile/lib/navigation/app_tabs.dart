import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/navigation/autospaced_navigation_destination.dart';
import 'package:publira/notifications/notification_inbox.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

/// The destinations of the tab navigation, in the order it shows them.
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
  Future<T?> pushInTab<T extends Object?>(String location, {Object? extra}) =>
      push<T>(AppTab.of(this).locate(location), extra: extra);

  /// Replaces the screen on top of this tab's stack with [location].
  void pushReplacementInTab(String location, {Object? extra}) =>
      pushReplacement(AppTab.of(this).locate(location), extra: extra);

  /// Replaces the screen on top of this tab's stack with [location], as the
  /// same page: its state is kept and no transition runs.
  void replaceInTab(String location) =>
      replace(AppTab.of(this).locate(location));

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

/// Every tab, one of them on screen, beside the navigation that switches
/// between them: a bar along the foot of a phone's window, and a rail down the
/// leading edge of a tablet's.
///
/// The navigation is left out while the episode viewer is on top, where the
/// page takes the whole screen; every other screen carries it, including the
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
    final showsRail = showsBar && isTabletWindow(context);
    final leftToRight = Directionality.of(context) == TextDirection.ltr;
    return Scaffold(
      body: Row(
        children: [
          if (showsRail)
            // The rail stands against the screen's edge, so it alone keeps
            // clear of a notch or a rounded corner on that side.
            SafeArea(
              left: leftToRight,
              right: !leftToRight,
              child: _AppTabRail(selectedIndex: current, onSelected: _select),
            ),
          // Keyed so the tabs keep their state, their stacks and their scroll
          // positions included, while the rail comes and goes beside them: a
          // tablet turned past the breakpoint, or the viewer opened over a
          // tab.
          Expanded(
            key: const ValueKey('tab-body'),
            // Read below the Scaffold, which has already taken the keyboard
            // and the bar out of what the tabs are told; the context above it
            // would hand both back, and every screen would make room for the
            // keyboard a second time.
            child: Builder(
              builder: (context) => MediaQuery.removePadding(
                context: context,
                removeLeft: showsRail && leftToRight,
                removeRight: showsRail && !leftToRight,
                child: IndexedStack(
                  index: current,
                  children: [
                    for (final (index, child) in children.indexed)
                      Offstage(
                        offstage: index != current,
                        child: TickerMode(
                          enabled: index == current,
                          // A field focused on a tab left behind would keep the
                          // keyboard over the tab the reader switched to.
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
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: showsBar && !showsRail
          ? _AppTabBar(selectedIndex: current, onSelected: _select)
          : null,
    );
  }
}

/// What both forms of the navigation show for one tab.
typedef _TabDestination = ({
  AppTab tab,
  Widget icon,
  Widget? selectedIcon,
  String label,
  String? tooltipMessage,
});

/// The tabs as the navigation shows them, in [AppTab] order.
List<_TabDestination> _destinations(BuildContext context) {
  final messages = AppMessages.of(context);
  final signedIn = AuthScope.of(context).isSignedIn;
  final unread = signedIn
      ? NotificationScope.maybeOf(context)?.unreadCount ?? 0
      : 0;
  Widget notificationsIcon(IconData icon) => Badge(
    key: const ValueKey('tab-notifications-unread'),
    isLabelVisible: unread > 0,
    label: AutospacedText(unreadBadgeLabel(messages, unread)),
    child: Icon(icon),
  );
  return [
    (
      tab: AppTab.home,
      icon: const Icon(Icons.home_outlined),
      selectedIcon: const Icon(Icons.home),
      label: messages.navigationHome,
      tooltipMessage: null,
    ),
    (
      tab: AppTab.search,
      icon: const Icon(Icons.search),
      selectedIcon: null,
      label: messages.navigationSearch,
      tooltipMessage: null,
    ),
    (
      tab: AppTab.library,
      icon: const Icon(Icons.collections_bookmark_outlined),
      selectedIcon: const Icon(Icons.collections_bookmark),
      label: messages.navigationLibrary,
      tooltipMessage: null,
    ),
    (
      tab: AppTab.notifications,
      icon: notificationsIcon(Icons.notifications_outlined),
      selectedIcon: notificationsIcon(Icons.notifications),
      label: messages.navigationNotifications,
      tooltipMessage: unread > 0
          ? messages.navigationNotificationsUnread(
              count: messages.formatInteger(unread),
            )
          : null,
    ),
    (
      tab: AppTab.account,
      icon: Icon(signedIn ? Icons.person : Icons.person_outline),
      selectedIcon: null,
      label: messages.navigationAccount,
      tooltipMessage: null,
    ),
  ];
}

/// The key a tab's destination is found by, the same in the bar and the rail.
ValueKey<String> _destinationKey(AppTab tab) => ValueKey('tab-${tab.name}');

class _AppTabBar extends StatelessWidget {
  const _AppTabBar({required this.selectedIndex, required this.onSelected});

  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return NavigationBar(
      key: const ValueKey('tab-bar'),
      selectedIndex: selectedIndex,
      destinations: [
        for (final destination in _destinations(context))
          AutospacedNavigationDestination(
            key: _destinationKey(destination.tab),
            icon: destination.icon,
            selectedIcon: destination.selectedIcon,
            label: destination.label,
            tooltipMessage: destination.tooltipMessage,
            selected: selectedIndex == destination.tab.index,
            index: destination.tab.index,
            count: AppTab.values.length,
            onTap: () => onSelected(destination.tab.index),
          ),
      ],
    );
  }
}

/// The tabs down the side of a tablet's window, where a bar would leave five
/// small targets along the foot of a large screen.
class _AppTabRail extends StatelessWidget {
  const _AppTabRail({required this.selectedIndex, required this.onSelected});

  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return NavigationRail(
      key: const ValueKey('tab-bar'),
      selectedIndex: selectedIndex,
      onDestinationSelected: onSelected,
      labelType: NavigationRailLabelType.all,
      // A phone on its side is past the breakpoint with little height to
      // spare, and five destinations do not fit it under a large text scale.
      // A taller window keeps the rail still, so the one vertical scroll view
      // beside it is the screen's own.
      scrollable: MediaQuery.sizeOf(context).height < compactWindowHeight,
      destinations: [
        for (final destination in _destinations(context))
          NavigationRailDestination(
            // On the icon, which is what a tap lands on; only one of the two
            // is built at a time.
            icon: _RailIcon(destination: destination, selected: false),
            selectedIcon: _RailIcon(destination: destination, selected: true),
            label: AutospacedText(destination.label),
          ),
      ],
    );
  }
}

/// The icon of one rail destination, found by the key the bar's destination
/// carries, and with the bar's long-press tooltip where it says more than the
/// label under it.
class _RailIcon extends StatelessWidget {
  const _RailIcon({required this.destination, required this.selected});

  final _TabDestination destination;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final icon = selected
        ? destination.selectedIcon ?? destination.icon
        : destination.icon;
    final tooltipMessage = destination.tooltipMessage;
    return KeyedSubtree(
      key: _destinationKey(destination.tab),
      child: tooltipMessage == null
          ? icon
          : AutospacedTooltip(
              message: tooltipMessage,
              excludeFromSemantics: true,
              child: icon,
            ),
    );
  }
}
