import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/creator/creator_failure.dart';
import 'package:publira/creator/creator_figures.dart';
import 'package:publira/creator/creator_repository.dart';
import 'package:publira/creator/creator_statement_csv.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/links/link_scope.dart';
import 'package:publira/models/my_creator.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

/// How many rows before the end of the list the page under it is asked for,
/// the same read-ahead the purchase history uses.
const _readAheadRows = 5;

/// One Author's part of one closed month, [period] (`YYYY-MM`): the totals
/// and the lines that credit them, adjustments for refunds of earlier months
/// marked. The app bar shares the month's lines as the CSV file the site
/// downloads.
class CreatorStatementScreen extends StatefulWidget {
  const CreatorStatementScreen({
    super.key,
    required this.creatorId,
    required this.period,
  });

  /// The [MyCreator.id] of the Author.
  final String creatorId;
  final String period;

  @override
  State<CreatorStatementScreen> createState() => _CreatorStatementScreenState();
}

class _CreatorStatementScreenState extends State<CreatorStatementScreen> {
  /// The Author, read with the first page so the header can name them and
  /// the CSV carry their public ID.
  MyCreator? _creator;
  MyCreatorStatement? _statement;
  var _lines = <MyCreatorStatementLine>[];
  var _nextToken = '';
  CreatorFailure? _failure;
  CreatorFailure? _moreFailure;

  /// Whether a page is in flight. Set without [setState], so the list can ask
  /// for a page while it builds.
  var _reading = false;
  var _reads = 0;
  var _started = false;

  /// Whether the lines are being read for the CSV, which keeps a second tap
  /// from starting another.
  var _sharing = false;

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
    if (repository == null || !AuthScope.of(context).isSignedIn) {
      return;
    }
    final read = ++_reads;
    setState(() {
      _creator = null;
      _statement = null;
      _lines = [];
      _nextToken = '';
      _failure = null;
      _moreFailure = null;
      _reading = true;
    });
    unawaited(_readFirst(repository, read));
  }

  Future<void> _readFirst(CreatorRepository repository, int read) async {
    MyCreator? creator;
    MyCreatorStatementDetail? detail;
    CreatorFailure? failure;
    try {
      final creators = await repository.listMyCreators();
      creator = creators.creators
          .where((creator) => creator.id == widget.creatorId)
          .firstOrNull;
      // An Author the account is not linked to has no statement to read.
      if (creator == null) {
        failure = const CreatorFailure(CreatorFailureKind.unavailable);
      } else {
        detail = await repository.statement(
          creatorId: widget.creatorId,
          period: widget.period,
        );
      }
    } on CreatorFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _reading = false;
      if (failure != null || creator == null || detail == null) {
        _failure = failure;
        return;
      }
      _creator = creator;
      _statement = detail.statement;
      _lines = detail.lines;
      _nextToken = detail.nextToken;
    });
  }

  /// Asks for the page under the last one, unless it is already on its way,
  /// the list ended, or the last attempt at it failed and is waiting on the
  /// footer's retry.
  void _readMore() {
    final repository = CreatorScope.maybeOf(context);
    if (repository == null ||
        _reading ||
        _nextToken.isEmpty ||
        _moreFailure != null) {
      return;
    }
    _reading = true;
    final read = _reads;
    final token = _nextToken;
    unawaited(() async {
      MyCreatorStatementDetail? detail;
      CreatorFailure? failure;
      try {
        detail = await repository.statement(
          creatorId: widget.creatorId,
          period: widget.period,
          token: token,
        );
      } on CreatorFailure catch (error) {
        failure = error;
      }
      if (!mounted || read != _reads) {
        return;
      }
      setState(() {
        _reading = false;
        if (detail == null) {
          _moreFailure = failure;
          return;
        }
        _lines = [..._lines, ...detail.lines];
        _nextToken = detail.nextToken;
      });
    }());
  }

  /// Reads every line afresh rather than the pages already on screen, so the
  /// file holds the whole month, and hands it to the share sheet.
  Future<void> _share() async {
    final repository = CreatorScope.maybeOf(context);
    final share = LinkScope.maybeOf(context)?.share;
    final creator = _creator;
    if (repository == null || share == null || creator == null || _sharing) {
      return;
    }
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    void reportFailure(String message) => messenger.showSnackBar(
      SnackBar(
        key: const ValueKey('creator-statement-share-failed'),
        content: AutospacedText(message),
      ),
    );
    final title = messages.creatorPagesStatementTitle(
      period: messages.formatCalendarMonth(widget.period),
    );
    setState(() => _sharing = true);
    try {
      Future<MyCreatorStatementDetail> page(String token) =>
          repository.statement(
            creatorId: widget.creatorId,
            period: widget.period,
            token: token,
            limit: myCreatorPageLimitMax,
          );
      var detail = await page('');
      final statement = detail.statement;
      final lines = [...detail.lines];
      while (detail.nextToken.isNotEmpty) {
        detail = await page(detail.nextToken);
        lines.addAll(detail.lines);
      }
      if (!mounted) {
        return;
      }
      await share.shareFile(
        bytes: utf8.encode(renderCreatorStatementCsv(statement, lines)),
        name: creatorStatementCsvName(creator, widget.period),
        mimeType: 'text/csv',
        title: title,
      );
    } on CreatorFailure catch (failure) {
      reportFailure(
        creatorFailureCopy(
          messages,
          failure,
          fallback: messages.creatorPagesShareCsvFailed,
        ),
      );
    } on PlatformException {
      // The share sheet could not be opened, so the file reached no one.
      reportFailure(messages.creatorPagesShareCsvFailed);
    } finally {
      if (mounted) {
        setState(() => _sharing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final canShare =
        LinkScope.maybeOf(context)?.share != null && _statement != null;
    return Scaffold(
      appBar: AppBar(
        title: AutospacedText(
          messages.creatorPagesStatementTitle(
            period: messages.formatCalendarMonth(widget.period),
          ),
        ),
        actions: [
          if (canShare)
            AutospacedTooltip(
              message: messages.creatorPagesShareCsv,
              child: IconButton(
                key: const ValueKey('creator-statement-share'),
                onPressed: _sharing ? null : _share,
                icon: _sharing
                    ? const SizedBox.square(
                        dimension: 24,
                        child: Padding(
                          padding: EdgeInsets.all(2),
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : const Icon(Icons.ios_share),
              ),
            ),
        ],
      ),
      body: SafeArea(child: _buildBody(context)),
    );
  }

  Widget _buildBody(BuildContext context) {
    final messages = AppMessages.of(context);
    if (!AuthScope.of(context).isSignedIn) {
      return const SignedOutNotice();
    }
    final failure = _failure;
    if (failure != null) {
      final signIn = failure.kind == CreatorFailureKind.sessionExpired;
      return CatalogMessage(
        key: const ValueKey('creator-statement-error'),
        message: creatorFailureCopy(
          messages,
          failure,
          fallback: messages.creatorPagesStatementFailed,
        ),
        failure: failure,
        actionKey: ValueKey(
          signIn ? 'creator-statement-sign-in' : 'creator-statement-retry',
        ),
        actionLabel: signIn ? messages.commonSignIn : messages.commonRetry,
        onAction: signIn
            ? () => context.pushInTab(AppRoutes.signIn)
            : _readFirstPage,
      );
    }
    final creator = _creator;
    final statement = _statement;
    if (creator == null || statement == null) {
      return const Padding(
        key: ValueKey('creator-statement-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final currency = statement.currency;
    final header = <Widget>[
      CreatorPagesHeader(
        creator: creator,
        subtitle: messages.creatorPagesStatementClosedAt(
          date: messages.formatDate(statement.closedAt),
          currency: currency,
        ),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: CreatorFigureGrid(
          children: [
            CreatorFigure(
              key: const ValueKey('creator-statement-sales'),
              label: messages.creatorPagesSales,
              value: messages.formatInteger(statement.saleCount),
            ),
            CreatorFigure(
              key: const ValueKey('creator-statement-gross'),
              label: messages.creatorPagesGross,
              value: messages.formatPrice(statement.grossAmount, currency),
            ),
            CreatorFigure(
              key: const ValueKey('creator-statement-refunded'),
              label: messages.creatorPagesRefunded,
              value: messages.formatPrice(statement.refundedAmount, currency),
            ),
            CreatorFigure(
              key: const ValueKey('creator-statement-payout'),
              label: messages.creatorPagesPayout,
              value: messages.formatPrice(statement.payoutAmount, currency),
            ),
          ],
        ),
      ),
      CreatorSectionHeading(
        title: messages.creatorPagesLinesHeading,
        description: messages.creatorPagesLinesDescription,
      ),
      if (_lines.isEmpty && _nextToken.isEmpty)
        Padding(
          key: const ValueKey('creator-statement-lines-empty'),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: AutospacedText(messages.creatorPagesLinesEmpty),
        ),
    ];
    final hasFooter = _nextToken.isNotEmpty || _moreFailure != null;
    final lines = _lines;
    return ReadableScrollPadding(
      padding: const EdgeInsets.only(bottom: 24),
      builder: (context, padding) => ListView.builder(
        key: const ValueKey('creator-statement-list'),
        padding: padding,
        itemCount: header.length + lines.length + (hasFooter ? 1 : 0),
        itemBuilder: (context, index) {
          if (index < header.length) {
            return header[index];
          }
          final row = index - header.length;
          if (row >= lines.length - _readAheadRows) {
            _readMore();
          }
          if (row == lines.length) {
            final moreFailure = _moreFailure;
            return moreFailure == null
                ? const Padding(
                    key: ValueKey('creator-statement-more-loading'),
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator()),
                  )
                : Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: RetryRow(
                      sectionKey: 'creator-statement-more',
                      message: creatorFailureCopy(
                        messages,
                        moreFailure,
                        fallback: messages.creatorPagesMoreFailed,
                      ),
                      failure: moreFailure,
                      onRetry: () {
                        setState(() => _moreFailure = null);
                        _readMore();
                      },
                    ),
                  );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              _LineRow(line: lines[row], currency: currency),
              const Divider(height: 1),
            ],
          );
        },
      ),
    );
  }
}

class _LineRow extends StatelessWidget {
  const _LineRow({required this.line, required this.currency});

  final MyCreatorStatementLine line;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final colors = Theme.of(context).colorScheme;
    final number = line.lineNumber;
    // A tip or subscription line is not the episode's sales, so it says what
    // it is. An adjustment takes back what it carries and keeps the source of
    // the line it adjusts, so it is marked apart beside that source.
    final marks = [
      if (line.source == CreatorStatementLineSource.tip)
        (
          key: ValueKey('creator-statement-tip-$number'),
          label: messages.creatorPagesTip,
          isAdjustment: false,
        ),
      if (line.source == CreatorStatementLineSource.subscription)
        (
          key: ValueKey('creator-statement-subscription-$number'),
          label: messages.creatorPagesSubscription,
          isAdjustment: false,
        ),
      if (line.isAdjustment)
        (
          key: ValueKey('creator-statement-adjustment-$number'),
          label: messages.creatorPagesAdjustment(
            period: messages.formatCalendarMonth(line.adjustedPeriod),
          ),
          isAdjustment: true,
        ),
    ];
    return ListTile(
      key: ValueKey('creator-statement-line-$number'),
      title: AutospacedText(line.episodeTitle),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          AutospacedText(line.seriesTitle),
          if (marks.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Wrap(
                spacing: 4,
                runSpacing: 4,
                children: [
                  for (final mark in marks)
                    Chip(
                      key: mark.key,
                      label: AutospacedText(mark.label),
                      backgroundColor: mark.isAdjustment
                          ? colors.errorContainer
                          : colors.secondaryContainer,
                      labelStyle: TextStyle(
                        color: mark.isAdjustment
                            ? colors.onErrorContainer
                            : colors.onSecondaryContainer,
                      ),
                      side: BorderSide.none,
                      visualDensity: VisualDensity.compact,
                    ),
                ],
              ),
            ),
          CreatorFigureLine(
            figures: [
              if (line.roleName.isNotEmpty)
                (
                  key: null,
                  label: messages.creatorPagesRole,
                  value: line.roleName,
                ),
              (
                key: null,
                label: messages.creatorPagesSales,
                value: messages.formatInteger(line.saleCount),
              ),
              (
                key: null,
                label: messages.creatorPagesGross,
                value: messages.formatPrice(line.grossAmount, currency),
              ),
              (
                key: null,
                label: messages.creatorPagesRefunded,
                value: messages.formatPrice(line.refundedAmount, currency),
              ),
              (
                key: null,
                label: messages.creatorPagesShare,
                value: messages.formatShareBps(line.shareBps),
              ),
              (
                key: ValueKey('creator-statement-line-payout-$number'),
                label: messages.creatorPagesPayout,
                value: messages.formatPrice(line.payoutAmount, currency),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
