import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/follow_tenant_link.dart';
import 'package:publira/links/link_scope.dart';
import 'package:publira/pages/page_failure.dart';
import 'package:publira/pages/page_repository.dart';
import 'package:publira/pages/published_page.dart';

/// A page the tenant published — its terms of service, its privacy policy,
/// or anything else it writes — set from the Markdown the API holds.
///
/// A link in the body goes where an announcement's link goes: a screen of the
/// app, another published page, or the browser for another site. Anything
/// else the text names, `javascript:` or a local file among them, is left
/// inert.
class PublishedPageScreen extends StatefulWidget {
  const PublishedPageScreen({super.key, required this.slug});

  /// In storage form (`/privacy`).
  final String slug;

  @override
  State<PublishedPageScreen> createState() => _PublishedPageScreenState();
}

class _PublishedPageScreenState extends State<PublishedPageScreen> {
  var _started = false;
  PublishedPage? _page;
  PageFailure? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    unawaited(_read());
  }

  Future<void> _read() async {
    final repository = PageScope.maybeOf(context);
    setState(() {
      _failure = null;
    });
    PublishedPage? page;
    PageFailure? failure;
    try {
      if (repository == null) {
        throw const PageFailure(PageFailureKind.unexpected);
      }
      page = await repository.get(widget.slug);
    } on PageFailure catch (error) {
      failure = error;
    } on Exception catch (error) {
      failure = PageFailure(
        PageFailureKind.unexpected,
        message: error.toString(),
      );
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _page = page;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(_page?.title ?? '')),
      body: SafeArea(child: _body(messages)),
    );
  }

  Widget _body(AppMessages messages) {
    final failure = _failure;
    if (failure != null) {
      return switch (failure.kind) {
        PageFailureKind.notFound => CatalogMessage(
          key: const ValueKey('page-not-found'),
          message: messages.pagesNotFound,
        ),
        PageFailureKind.network => CatalogMessage(
          key: const ValueKey('page-error'),
          message: messages.errorsRpcUnavailable,
          actionKey: const ValueKey('page-retry'),
          actionLabel: messages.commonRetry,
          onAction: _read,
        ),
        PageFailureKind.unexpected => CatalogMessage(
          key: const ValueKey('page-error'),
          message: messages.pagesLoadFailed,
          actionKey: const ValueKey('page-retry'),
          actionLabel: messages.commonRetry,
          onAction: _read,
        ),
      };
    }
    final page = _page;
    if (page == null) {
      return const Padding(
        key: ValueKey('page-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final theme = Theme.of(context);
    return ListView(
      key: ValueKey('page-${page.slug}'),
      padding: const EdgeInsets.all(16),
      children: [
        if (page.contentMarkdown.trim().isEmpty)
          Text(
            messages.pagesBodyEmpty,
            key: const ValueKey('page-body-empty'),
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          )
        else
          MarkdownBody(
            key: const ValueKey('page-body'),
            data: page.contentMarkdown,
            selectable: true,
            styleSheet: _styleSheet(theme),
            onTapLink: (text, href, title) {
              if (href == null) {
                return;
              }
              final destination = tenantLinkDestinationFrom(context, href);
              if (destination != null) {
                followTenantLink(context, destination);
              }
            },
            imageBuilder: (uri, title, alt) => _PageImage(uri: uri, alt: alt),
          ),
      ],
    );
  }

  /// Every heading one step above the body, as the site sets them: the level
  /// says where the reader is in the structure, not how loud it is.
  MarkdownStyleSheet _styleSheet(ThemeData theme) {
    final heading = theme.textTheme.titleLarge;
    return MarkdownStyleSheet.fromTheme(theme).copyWith(
      p: theme.textTheme.bodyLarge,
      h1: heading,
      h2: heading,
      h3: heading,
      h4: heading,
      h5: heading,
      h6: heading,
    );
  }
}

/// An image the page embeds, fetched only from an `https` address — on the
/// tenant site for a path — so the text cannot make the app read a local file
/// or a bundled asset.
class _PageImage extends StatelessWidget {
  const _PageImage({required this.uri, required this.alt});

  final Uri uri;
  final String? alt;

  @override
  Widget build(BuildContext context) {
    final url = _resolve(context);
    final fallback = alt == null || alt!.isEmpty
        ? const SizedBox.shrink()
        : Text(alt!);
    if (url == null) {
      return fallback;
    }
    return Image.network(
      url.toString(),
      semanticLabel: alt,
      errorBuilder: (context, error, stackTrace) => fallback,
    );
  }

  Uri? _resolve(BuildContext context) {
    if (uri.scheme == 'https' && uri.host.isNotEmpty) {
      return uri;
    }
    final site = LinkScope.maybeOf(context)?.site;
    final raw = uri.toString();
    if (site == null ||
        uri.hasScheme ||
        !raw.startsWith('/') ||
        raw.startsWith('//')) {
      return null;
    }
    return Uri.parse('https://${site.host}').resolveUri(uri);
  }
}
