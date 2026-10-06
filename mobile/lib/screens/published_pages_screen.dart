import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/pages/page_failure.dart';
import 'package:publira/pages/page_repository.dart';
import 'package:publira/pages/published_page.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Every page the storefront's footer lists — the terms a reader agreed to,
/// the privacy policy, and whatever else the tenant publishes there — titled
/// in the app's language where a page is translated into it, each opening
/// the page screen.
class PublishedPagesScreen extends StatefulWidget {
  const PublishedPagesScreen({super.key});

  @override
  State<PublishedPagesScreen> createState() => _PublishedPagesScreenState();
}

class _PublishedPagesScreenState extends State<PublishedPagesScreen> {
  /// The locale the list was last asked for, which a change of the device's
  /// language moves, reading the list again.
  Locale? _locale;
  List<PublishedPageLink>? _pages;
  PageFailure? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = Localizations.localeOf(context);
    if (locale == _locale) {
      return;
    }
    _locale = locale;
    unawaited(_read());
  }

  Future<void> _read() async {
    final repository = PageScope.maybeOf(context);
    final locale = Localizations.localeOf(context);
    setState(() {
      _failure = null;
    });
    List<PublishedPageLink>? pages;
    PageFailure? failure;
    try {
      if (repository == null) {
        throw const PageFailure(PageFailureKind.unexpected);
      }
      pages = await repository.list(locale: locale.toLanguageTag());
    } on PageFailure catch (error) {
      failure = error;
    } on Exception catch (error) {
      failure = PageFailure(
        PageFailureKind.unexpected,
        message: error.toString(),
      );
    }
    if (!mounted || locale != _locale) {
      return;
    }
    setState(() {
      _pages = pages;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.accountPages)),
      body: SafeArea(child: _body(messages)),
    );
  }

  Widget _body(AppMessages messages) {
    final failure = _failure;
    if (failure != null) {
      return CatalogMessage(
        key: const ValueKey('pages-error'),
        message: failure.kind == PageFailureKind.network
            ? messages.errorsRpcUnavailable
            : messages.pagesListLoadFailed,
        actionKey: const ValueKey('pages-retry'),
        actionLabel: messages.commonRetry,
        onAction: _read,
      );
    }
    final pages = _pages;
    if (pages == null) {
      return const Padding(
        key: ValueKey('pages-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (pages.isEmpty) {
      return CatalogMessage(
        key: const ValueKey('pages-empty'),
        message: messages.pagesListEmpty,
      );
    }
    return ReadableScrollPadding(
      builder: (context, padding) => ListView.separated(
        key: const ValueKey('pages-list'),
        padding: padding,
        itemCount: pages.length,
        separatorBuilder: (context, index) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final page = pages[index];
          return ListTile(
            key: ValueKey('pages-row-${page.slug}'),
            title: AutospacedText(page.title),
            trailing: const Icon(Icons.chevron_right),
            onTap: () =>
                context.pushInTab(AppRoutes.publishedPagePath(page.slug)),
          );
        },
      ),
    );
  }
}
