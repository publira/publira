import 'dart:async';

import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/creator/creator_failure.dart';
import 'package:publira/creator/creator_figures.dart';
import 'package:publira/creator/creator_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/models/my_creator.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The pages of the Authors the reader's account is linked to: one Author at
/// a time, switched with tabs when there are several, as the site's My Page
/// shows them.
///
/// Each Author's page leads to what readers say about their episodes, and
/// states the follower count and how their episodes were read over the
/// tenant's last 28 whole days, and, where the tenant shows its Authors their
/// sales, each episode's sales and the Author's part of every closed month,
/// which opens that month's lines.
///
/// [creatorId] is the [MyCreator.id] of the Author to open on, and the first
/// one when `null`.
class CreatorPagesScreen extends StatefulWidget {
  const CreatorPagesScreen({super.key, this.creatorId});

  final String? creatorId;

  @override
  State<CreatorPagesScreen> createState() => _CreatorPagesScreenState();
}

class _CreatorPagesScreenState extends State<CreatorPagesScreen> {
  MyCreators? _creators;
  CreatorFailure? _failure;
  var _started = false;

  /// Counts the reads this screen has started, so an answer to one the
  /// reader retried past cannot land on the screen.
  var _reads = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _read();
  }

  void _read() {
    final repository = CreatorScope.maybeOf(context);
    if (repository == null || !AuthScope.of(context).isSignedIn) {
      return;
    }
    final read = ++_reads;
    setState(() {
      _creators = null;
      _failure = null;
    });
    unawaited(
      repository.listMyCreators().then(
        (creators) {
          if (mounted && read == _reads) {
            setState(() => _creators = creators);
          }
        },
        onError: (Object error) {
          if (error is! CreatorFailure) {
            throw error;
          }
          if (mounted && read == _reads) {
            setState(() => _failure = error);
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final creators = _creators?.creators;
    final index = creators == null
        ? -1
        : widget.creatorId == null
        ? 0
        : creators.indexWhere((creator) => creator.id == widget.creatorId);
    // Tabs only for an account linked to more than one Author, and only once
    // the one asked for is among them.
    final tabbed = creators != null && creators.length > 1 && index >= 0
        ? creators
        : null;
    final scaffold = Scaffold(
      appBar: AppBar(
        title: AutospacedText(messages.creatorPagesTitle),
        bottom: tabbed != null
            ? TabBar(
                key: const ValueKey('creator-pages-tabs'),
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                tabs: [
                  for (final creator in tabbed)
                    Tab(
                      key: ValueKey('creator-pages-tab-${creator.id}'),
                      child: AutospacedText(creator.name),
                    ),
                ],
              )
            : null,
      ),
      body: SafeArea(child: _buildBody(context, index)),
    );
    return tabbed != null
        ? DefaultTabController(
            length: tabbed.length,
            initialIndex: index,
            child: scaffold,
          )
        : scaffold;
  }

  Widget _buildBody(BuildContext context, int index) {
    final messages = AppMessages.of(context);
    if (!AuthScope.of(context).isSignedIn) {
      return const SignedOutNotice();
    }
    final failure = _failure;
    if (failure != null) {
      // Retrying would send the token the API just refused.
      final signIn = failure.kind == CreatorFailureKind.sessionExpired;
      return CatalogMessage(
        key: const ValueKey('creator-pages-error'),
        message: creatorFailureCopy(
          messages,
          failure,
          fallback: messages.creatorPagesLoadFailed,
        ),
        failure: failure,
        actionKey: ValueKey(
          signIn ? 'creator-pages-sign-in' : 'creator-pages-retry',
        ),
        actionLabel: signIn ? messages.commonSignIn : messages.commonRetry,
        onAction: signIn ? () => context.pushInTab(AppRoutes.signIn) : _read,
      );
    }
    final creators = _creators;
    if (creators == null) {
      return const Padding(
        key: ValueKey('creator-pages-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    // An Author the account is no longer linked to, or an account linked to
    // none any more, has no page to show.
    if (index < 0 || creators.creators.isEmpty) {
      return CatalogMessage(
        key: const ValueKey('creator-pages-not-found'),
        message: messages.creatorPagesNotFound,
      );
    }
    if (creators.creators.length == 1) {
      return _CreatorPage(
        creator: creators.creators.single,
        salesVisible: creators.salesVisible,
      );
    }
    return TabBarView(
      children: [
        for (final creator in creators.creators)
          _CreatorPage(
            key: ValueKey(creator.id),
            creator: creator,
            salesVisible: creators.salesVisible,
          ),
      ],
    );
  }
}

/// One Author's page. Its figures and its closed months read on their own, so
/// a failing one costs the page that section alone, and are kept while the
/// reader looks at another Author's tab.
class _CreatorPage extends StatefulWidget {
  const _CreatorPage({
    super.key,
    required this.creator,
    required this.salesVisible,
  });

  final MyCreator creator;
  final bool salesVisible;

  @override
  State<_CreatorPage> createState() => _CreatorPageState();
}

class _CreatorPageState extends State<_CreatorPage>
    with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final messages = AppMessages.of(context);
    final creator = widget.creator;
    return ReadableScrollPadding(
      padding: const EdgeInsets.only(bottom: 24),
      builder: (context, padding) => ListView(
        key: ValueKey('creator-pages-${creator.id}'),
        padding: padding,
        children: [
          CreatorPagesHeader(
            creator: creator,
            subtitle: messages.creatorPagesDescription,
          ),
          ListTile(
            key: ValueKey('creator-pages-comments-${creator.id}'),
            leading: const Icon(Icons.forum_outlined),
            title: AutospacedText(messages.creatorCommentsLink),
            subtitle: AutospacedText(messages.creatorCommentsDescription),
            trailing: const Icon(Icons.chevron_right),
            onTap: () =>
                context.push(AppRoutes.accountCreatorCommentsPath(creator.id)),
          ),
          const Divider(height: 1),
          _StatsSection(creator: creator),
          if (widget.salesVisible) _StatementsSection(creator: creator),
        ],
      ),
    );
  }
}

/// The follower count, the window's four figures, and the episodes crediting
/// the Author, a page at a time.
class _StatsSection extends StatefulWidget {
  const _StatsSection({required this.creator});

  final MyCreator creator;

  @override
  State<_StatsSection> createState() => _StatsSectionState();
}

class _StatsSectionState extends State<_StatsSection> {
  /// The first page, which holds the window and its totals.
  MyCreatorStats? _stats;

  /// Every page of episodes read so far as one list.
  var _episodes = <MyCreatorEpisodeStats>[];
  var _nextToken = '';
  CreatorFailure? _failure;
  CreatorFailure? _moreFailure;
  var _readingMore = false;
  var _locale = '';
  var _reads = 0;

  /// Reads the figures again when the language changes, since the titles are
  /// given in it.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = Localizations.localeOf(context).toLanguageTag();
    if (locale == _locale) {
      return;
    }
    _locale = locale;
    _readFirstPage();
  }

  void _readFirstPage() {
    final repository = CreatorScope.maybeOf(context);
    if (repository == null) {
      return;
    }
    final read = ++_reads;
    setState(() {
      _stats = null;
      _episodes = [];
      _nextToken = '';
      _failure = null;
      _moreFailure = null;
      _readingMore = false;
    });
    unawaited(
      _page(repository, '').then((page) {
        if (!mounted || read != _reads) {
          return;
        }
        setState(() {
          switch (page) {
            case (final MyCreatorStats stats, null):
              _stats = stats;
              _episodes = stats.episodes;
              _nextToken = stats.nextToken;
            case (_, final failure):
              _failure = failure;
          }
        });
      }),
    );
  }

  void _readMore() {
    final repository = CreatorScope.maybeOf(context);
    if (repository == null || _readingMore || _nextToken.isEmpty) {
      return;
    }
    final read = _reads;
    setState(() {
      _readingMore = true;
      _moreFailure = null;
    });
    unawaited(
      _page(repository, _nextToken).then((page) {
        if (!mounted || read != _reads) {
          return;
        }
        setState(() {
          _readingMore = false;
          switch (page) {
            case (final MyCreatorStats stats, null):
              _episodes = [..._episodes, ...stats.episodes];
              _nextToken = stats.nextToken;
            case (_, final failure):
              _moreFailure = failure;
          }
        });
      }),
    );
  }

  Future<(MyCreatorStats?, CreatorFailure?)> _page(
    CreatorRepository repository,
    String token,
  ) async {
    try {
      final stats = await repository.stats(
        creatorId: widget.creator.id,
        locale: _locale,
        token: token,
      );
      return (stats, null);
    } on CreatorFailure catch (failure) {
      return (null, failure);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final failure = _failure;
    if (failure != null) {
      return Padding(
        padding: const EdgeInsets.only(top: 16),
        child: RetryRow(
          sectionKey: 'creator-pages-stats',
          message: creatorFailureCopy(
            messages,
            failure,
            fallback: messages.creatorPagesStatsFailed,
          ),
          failure: failure,
          onRetry: _readFirstPage,
        ),
      );
    }
    final stats = _stats;
    if (stats == null) {
      return const Padding(
        key: ValueKey('creator-pages-stats-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Column(
      key: const ValueKey('creator-pages-stats'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AutospacedText(
                messages.creatorPagesPeriod(
                  start: messages.formatCalendarDate(stats.periodStart),
                  end: messages.formatCalendarDate(stats.periodEnd),
                  timeZone: stats.timeZone,
                ),
                key: const ValueKey('creator-pages-period'),
                style: muted,
              ),
              const SizedBox(height: 12),
              CreatorFigureGrid(
                children: [
                  CreatorFigure(
                    key: const ValueKey('creator-pages-followers'),
                    label: messages.creatorPagesFollowers,
                    value: messages.formatInteger(stats.followerCount),
                  ),
                  CreatorFigure(
                    key: const ValueKey('creator-pages-member-views'),
                    label: messages.creatorPagesMemberViews,
                    value: messages.formatInteger(stats.totalMemberViewCount),
                  ),
                  CreatorFigure(
                    key: const ValueKey('creator-pages-completions'),
                    label: messages.creatorPagesCompletions,
                    value: messages.formatInteger(stats.totalCompleteCount),
                  ),
                  CreatorFigure(
                    key: const ValueKey('creator-pages-read-through-rate'),
                    label: messages.creatorPagesReadThroughRate,
                    value: _readThroughRate(
                      messages,
                      stats.totalCompleteCount,
                      stats.totalMemberViewCount,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              AutospacedText(
                messages.creatorPagesFiguresDefinition,
                style: muted,
              ),
            ],
          ),
        ),
        CreatorSectionHeading(
          title: messages.creatorPagesEpisodesHeading,
          description: messages.creatorPagesEpisodesDescription,
        ),
        if (_episodes.isEmpty && _nextToken.isEmpty)
          Padding(
            key: const ValueKey('creator-pages-episodes-empty'),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: AutospacedText(messages.creatorPagesEpisodesEmpty),
          ),
        for (final episode in _episodes) ...[
          _EpisodeRow(episode: episode, currency: stats.currency),
          const Divider(height: 1),
        ],
        _MoreFooter(
          sectionKey: 'creator-pages-episodes-more',
          hasMore: _nextToken.isNotEmpty,
          reading: _readingMore,
          failure: _moreFailure,
          onMore: _readMore,
        ),
      ],
    );
  }
}

/// Completions over member views, as the console's read-through report words
/// it, and a dash where nothing was viewed: a rate over no views is not zero.
String _readThroughRate(AppMessages messages, int completes, int views) =>
    views > 0
    ? messages.formatRatio(completes / views)
    : messages.creatorPagesRateUnavailable;

class _EpisodeRow extends StatelessWidget {
  const _EpisodeRow({required this.episode, required this.currency});

  final MyCreatorEpisodeStats episode;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final id = episode.episodePublicId;
    final purchaseCount = episode.purchaseCount;
    final netAmount = episode.netAmount;
    return ListTile(
      key: ValueKey('creator-pages-episode-$id'),
      title: AutospacedText(episode.episodeTitle),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          AutospacedText(episode.seriesTitle),
          CreatorFigureLine(
            figures: [
              (
                key: null,
                label: messages.creatorPagesMemberViews,
                value: messages.formatInteger(episode.memberViewCount),
              ),
              (
                key: null,
                label: messages.creatorPagesCompletions,
                value: messages.formatInteger(episode.completeCount),
              ),
              (
                key: ValueKey('creator-pages-episode-rate-$id'),
                label: messages.creatorPagesReadThroughRate,
                value: _readThroughRate(
                  messages,
                  episode.completeCount,
                  episode.memberViewCount,
                ),
              ),
              if (purchaseCount != null)
                (
                  key: ValueKey('creator-pages-episode-sales-$id'),
                  label: messages.creatorPagesSales,
                  value: messages.formatInteger(purchaseCount),
                ),
              if (netAmount != null)
                (
                  key: ValueKey('creator-pages-episode-net-$id'),
                  label: messages.creatorPagesNetAmount,
                  value: messages.formatPrice(netAmount, currency),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The Author's part of every closed month, a page at a time, each opening
/// that month's lines.
class _StatementsSection extends StatefulWidget {
  const _StatementsSection({required this.creator});

  final MyCreator creator;

  @override
  State<_StatementsSection> createState() => _StatementsSectionState();
}

class _StatementsSectionState extends State<_StatementsSection> {
  List<MyCreatorStatement>? _statements;
  var _nextToken = '';
  CreatorFailure? _failure;
  CreatorFailure? _moreFailure;
  var _readingMore = false;
  var _reads = 0;
  var _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _readFirstPage();
  }

  void _readFirstPage() {
    final repository = CreatorScope.maybeOf(context);
    if (repository == null) {
      return;
    }
    final read = ++_reads;
    setState(() {
      _statements = null;
      _nextToken = '';
      _failure = null;
      _moreFailure = null;
      _readingMore = false;
    });
    unawaited(
      _page(repository, '').then((page) {
        if (!mounted || read != _reads) {
          return;
        }
        setState(() {
          switch (page) {
            case (final MyCreatorStatementPage statements, null):
              _statements = statements.statements;
              _nextToken = statements.nextToken;
            case (_, final failure):
              _failure = failure;
          }
        });
      }),
    );
  }

  void _readMore() {
    final repository = CreatorScope.maybeOf(context);
    if (repository == null || _readingMore || _nextToken.isEmpty) {
      return;
    }
    final read = _reads;
    setState(() {
      _readingMore = true;
      _moreFailure = null;
    });
    unawaited(
      _page(repository, _nextToken).then((page) {
        if (!mounted || read != _reads) {
          return;
        }
        setState(() {
          _readingMore = false;
          switch (page) {
            case (final MyCreatorStatementPage statements, null):
              _statements = [...?_statements, ...statements.statements];
              _nextToken = statements.nextToken;
            case (_, final failure):
              _moreFailure = failure;
          }
        });
      }),
    );
  }

  Future<(MyCreatorStatementPage?, CreatorFailure?)> _page(
    CreatorRepository repository,
    String token,
  ) async {
    try {
      final page = await repository.listStatements(
        creatorId: widget.creator.id,
        token: token,
      );
      return (page, null);
    } on CreatorFailure catch (failure) {
      return (null, failure);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final failure = _failure;
    final statements = _statements;
    return Column(
      key: const ValueKey('creator-pages-statements'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        CreatorSectionHeading(
          title: messages.creatorPagesStatementsHeading,
          description: messages.creatorPagesStatementsDescription,
        ),
        if (failure != null)
          RetryRow(
            sectionKey: 'creator-pages-statements',
            message: creatorFailureCopy(
              messages,
              failure,
              fallback: messages.creatorPagesStatementsFailed,
            ),
            failure: failure,
            onRetry: _readFirstPage,
          )
        else if (statements == null)
          const Padding(
            key: ValueKey('creator-pages-statements-loading'),
            padding: EdgeInsets.all(24),
            child: Center(child: CircularProgressIndicator()),
          )
        else ...[
          if (statements.isEmpty && _nextToken.isEmpty)
            Padding(
              key: const ValueKey('creator-pages-statements-empty'),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: AutospacedText(messages.creatorPagesStatementsEmpty),
            ),
          for (final statement in statements) ...[
            _StatementRow(creator: widget.creator, statement: statement),
            const Divider(height: 1),
          ],
          _MoreFooter(
            sectionKey: 'creator-pages-statements-more',
            hasMore: _nextToken.isNotEmpty,
            reading: _readingMore,
            failure: _moreFailure,
            onMore: _readMore,
          ),
        ],
      ],
    );
  }
}

class _StatementRow extends StatelessWidget {
  const _StatementRow({required this.creator, required this.statement});

  final MyCreator creator;
  final MyCreatorStatement statement;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final currency = statement.currency;
    return ListTile(
      key: ValueKey('creator-pages-statement-${statement.period}'),
      title: AutospacedText(messages.formatCalendarMonth(statement.period)),
      subtitle: CreatorFigureLine(
        figures: [
          (
            key: null,
            label: messages.creatorPagesSales,
            value: messages.formatInteger(statement.saleCount),
          ),
          (
            key: null,
            label: messages.creatorPagesGross,
            value: messages.formatPrice(statement.grossAmount, currency),
          ),
          (
            key: null,
            label: messages.creatorPagesRefunded,
            value: messages.formatPrice(statement.refundedAmount, currency),
          ),
          (
            key: ValueKey('creator-pages-statement-payout-${statement.period}'),
            label: messages.creatorPagesPayout,
            value: messages.formatPrice(statement.payoutAmount, currency),
          ),
        ],
      ),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.push(
        AppRoutes.accountCreatorStatementPath(creator.id, statement.period),
      ),
    );
  }
}

/// The way to the next page of a section: a button while there is one, a
/// spinner while it is read, and what went wrong when it could not be.
class _MoreFooter extends StatelessWidget {
  const _MoreFooter({
    required this.sectionKey,
    required this.hasMore,
    required this.reading,
    required this.failure,
    required this.onMore,
  });

  final String sectionKey;
  final bool hasMore;
  final bool reading;
  final CreatorFailure? failure;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final failure = this.failure;
    if (failure != null) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: RetryRow(
          sectionKey: sectionKey,
          message: creatorFailureCopy(
            messages,
            failure,
            fallback: messages.creatorPagesMoreFailed,
          ),
          failure: failure,
          onRetry: onMore,
        ),
      );
    }
    if (reading) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (!hasMore) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Center(
        child: OutlinedButton(
          key: ValueKey(sectionKey),
          onPressed: onMore,
          child: AutospacedText(messages.creatorPagesShowMore),
        ),
      ),
    );
  }
}
