import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/follow/follow_control.dart';
import 'package:publira/follow/follow_failure.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/follow.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// How many rows before the end of the list the page under it is asked for,
/// the same read-ahead the catalog and the search results use.
const _readAheadRows = 5;

/// The series and authors the reader follows, newest follow first, as the
/// library shows them.
///
/// A row opens its series or its author.
class FollowsList extends StatefulWidget {
  const FollowsList({super.key});

  @override
  State<FollowsList> createState() => _FollowsListState();
}

class _FollowsListState extends State<FollowsList> {
  /// Every page read so far as one list, and `null` while the first is still
  /// in flight.
  List<_FollowedTarget>? _targets;

  /// What the API calls the page under [_targets]. Empty at the end of the
  /// list, which is what takes the footer away.
  var _nextToken = '';

  /// The first page's failure, which is the whole screen, and a later page's,
  /// which is the footer under the rows already on screen.
  FollowFailure? _failure;
  FollowFailure? _moreFailure;

  /// Whether a page is in flight. The screen is not built from it, so it is
  /// set without [setState], which is what lets the list ask for a page while
  /// it builds.
  var _reading = false;

  /// Counts the reads this screen has started, so an answer meant for the
  /// reader before this one cannot land on the list.
  var _reads = 0;

  var _accessToken = '';
  var _started = false;

  /// Reads the list again whenever the reader changes: what is followed
  /// belongs to whoever holds the session, and a sign-out leaves the screen
  /// with nothing of its own to show.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final accessToken = AuthScope.of(context).accessToken;
    if (_started && accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _readFirstPage();
  }

  void _readFirstPage() {
    setState(() {
      _targets = null;
      _nextToken = '';
      _failure = null;
      _moreFailure = null;
      _reading = _accessToken.isNotEmpty;
    });
    _reads++;
    if (_accessToken.isEmpty) {
      return;
    }
    unawaited(_read(_reads, ''));
  }

  /// Asks for the page under the last one, unless it is already on its way,
  /// the list ended, or the last attempt at it failed and is waiting on the
  /// footer's retry.
  void _readMore() {
    if (_reading || _nextToken.isEmpty || _moreFailure != null) {
      return;
    }
    _reading = true;
    unawaited(_read(++_reads, _nextToken));
  }

  /// Reads the page [token] names, resolves what its rows are called, and puts
  /// them under what is already there.
  Future<void> _read(int read, String token) async {
    final follows = FollowScope.maybeOf(context);
    final catalog = CatalogScope.of(context);
    if (follows == null) {
      return;
    }
    final isFirstPage = token.isEmpty;
    MyFollowPage? page;
    FollowFailure? failure;
    List<_FollowedTarget> targets = const [];
    try {
      page = await follows.listMyFollows(token: token);
      targets = await _resolveNames(catalog, page.follows);
    } on FollowFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _reading = false;
      if (page == null) {
        if (isFirstPage) {
          _failure = failure;
        } else {
          _moreFailure = failure;
        }
        return;
      }
      _targets = [if (!isFirstPage) ...?_targets, ...targets];
      _nextToken = page.nextToken;
    });
  }

  /// What each row is called, read from the public catalog.
  ///
  /// `ListMyFollows` answers with public ids alone, so every row costs a
  /// catalog read of its own; they are asked for together rather than one
  /// after the next. The reads name the target without going through what the
  /// device keeps, because a reader who follows a series has not opened it. A
  /// read that failed leaves the row named by its public id, which is still a
  /// row the reader can unfollow.
  Future<List<_FollowedTarget>> _resolveNames(
    CatalogRepository catalog,
    List<MyFollow> follows,
  ) {
    return Future.wait(
      follows.map((follow) async {
        return _FollowedTarget(
          follow: follow,
          name: await _name(catalog, follow),
        );
      }),
    );
  }

  Future<String> _name(CatalogRepository catalog, MyFollow follow) async {
    try {
      final name = switch (follow.kind) {
        FollowTargetKind.series => await catalog.getSeriesTitle(
          follow.targetId,
        ),
        FollowTargetKind.creator => (await catalog.getCreator(
          follow.targetId,
        ))?.name,
      };
      return name == null || name.isEmpty ? follow.targetId : name;
    } on CatalogFailure {
      return follow.targetId;
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    if (FollowScope.maybeOf(context) == null) {
      return const SizedBox.shrink();
    }
    if (!AuthScope.of(context).isSignedIn) {
      return CatalogMessage(
        key: const ValueKey('follows-signed-out'),
        message: messages.followsSignInPrompt,
        actionKey: const ValueKey('follows-sign-in'),
        actionLabel: messages.commonSignIn,
        onAction: () => context.pushInTab(AppRoutes.signIn),
      );
    }
    final failure = _failure;
    if (failure != null) {
      return CatalogMessage(
        key: const ValueKey('follows-error'),
        message: _failureCopy(messages, failure),
        actionKey: const ValueKey('follows-retry'),
        actionLabel: messages.commonRetry,
        onAction: _readFirstPage,
      );
    }
    final targets = _targets;
    if (targets == null) {
      return const Padding(
        key: ValueKey('follows-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    // The footer is the page under the list: a spinner while there is one left
    // to read, and what went wrong when the last attempt at it failed.
    final hasFooter = _nextToken.isNotEmpty || _moreFailure != null;
    if (targets.isEmpty && !hasFooter) {
      return CatalogMessage(
        key: const ValueKey('follows-empty'),
        message: messages.followsEmpty,
      );
    }
    return ListView.separated(
      key: const ValueKey('follows-list'),
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: targets.length + (hasFooter ? 1 : 0),
      separatorBuilder: (context, index) => const Divider(height: 1),
      itemBuilder: (context, index) {
        if (index >= targets.length - _readAheadRows) {
          _readMore();
        }
        if (index == targets.length) {
          return _FollowsPageFooter(
            message: _moreFailure == null
                ? null
                : _failureCopy(messages, _moreFailure!),
            onRetry: () {
              setState(() {
                _moreFailure = null;
              });
              _readMore();
            },
          );
        }
        return _FollowRow(target: targets[index]);
      },
    );
  }

  String _failureCopy(AppMessages messages, FollowFailure failure) {
    return switch (failure.kind) {
      FollowFailureKind.network => messages.errorsRpcUnavailable,
      FollowFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
      FollowFailureKind.gone ||
      FollowFailureKind.unexpected => messages.followsFailed,
    };
  }
}

/// One followed target and what the catalog calls it.
class _FollowedTarget {
  const _FollowedTarget({required this.follow, required this.name});

  final MyFollow follow;

  /// The series title or author name, and the public id when the catalog
  /// could not be asked.
  final String name;
}

class _FollowRow extends StatelessWidget {
  const _FollowRow({required this.target});

  final _FollowedTarget target;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final follow = target.follow;
    final isSeries = follow.kind == FollowTargetKind.series;
    final details = <String>[
      isSeries ? messages.followsKindSeries : messages.followsKindCreator,
      if (follow.followedAt case final followedAt?)
        messages.followsFollowedAt(date: messages.formatDateTime(followedAt)),
    ];
    return ListTile(
      key: ValueKey('follow-row-${follow.targetId}'),
      title: Text(target.name),
      subtitle: Text(details.join(' · ')),
      trailing: FollowControl(
        kind: follow.kind,
        targetId: follow.targetId,
        targetName: target.name,
        // Every row of this list is followed, so the control has its state
        // without asking for it once per row.
        following: true,
      ),
      onTap: () => context.pushInTab(
        isSeries
            ? AppRoutes.seriesDetailPath(follow.targetId)
            : AppRoutes.creatorDetailPath(follow.targetId),
      ),
    );
  }
}

/// The page under the list, at the bottom of it: a spinner while that page is
/// being read, and what went wrong when it could not be.
class _FollowsPageFooter extends StatelessWidget {
  const _FollowsPageFooter({required this.message, required this.onRetry});

  /// What went wrong reading the page, and `null` while it is still on its
  /// way.
  final String? message;

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = this.message;
    if (message == null) {
      return const Padding(
        key: ValueKey('follows-more-loading'),
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: RetryRow(
        sectionKey: 'follows-more',
        message: message,
        onRetry: onRetry,
      ),
    );
  }
}
