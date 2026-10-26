import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/coins/coin_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/external_browser.dart';
import 'package:publira/links/link_scope.dart';
import 'package:publira/typography/autospaced_text.dart';

/// What the tenant discloses wherever its coins are sold: the issuer, the
/// terms, how to reach the issuer, and its own notice. Each is left out where
/// the tenant wrote nothing, and the whole of it where it wrote nothing at all.
///
/// The terms open in the system browser, where a run with no browser offers no
/// link to them.
class CoinDisclosuresView extends StatelessWidget {
  const CoinDisclosuresView({
    super.key,
    required this.disclosures,
    this.alignment = CrossAxisAlignment.start,
  });

  final CoinDisclosures disclosures;
  final CrossAxisAlignment alignment;

  @override
  Widget build(BuildContext context) {
    if (disclosures.isEmpty) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final style = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final textAlign = alignment == CrossAxisAlignment.center
        ? TextAlign.center
        : TextAlign.start;
    final terms = disclosures.termsUrl;
    final browser = LinkScope.maybeOf(context)?.browser;
    return Column(
      key: const ValueKey('coin-disclosures'),
      crossAxisAlignment: alignment,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (disclosures.issuerName.isNotEmpty)
          AutospacedText(
            '${messages.coinsIssuer}: ${disclosures.issuerName}',
            style: style,
            textAlign: textAlign,
          ),
        if (disclosures.contact.isNotEmpty)
          AutospacedText(
            '${messages.coinsContact}: ${disclosures.contact}',
            style: style,
            textAlign: textAlign,
          ),
        if (disclosures.notice.isNotEmpty) ...[
          const SizedBox(height: 4),
          AutospacedText(
            disclosures.notice,
            style: style,
            textAlign: textAlign,
          ),
        ],
        if (terms != null && browser != null)
          TextButton(
            key: const ValueKey('coin-terms'),
            onPressed: () => unawaited(_openTerms(context, browser, terms)),
            child: AutospacedText(messages.coinsTermsLink),
          ),
      ],
    );
  }

  Future<void> _openTerms(
    BuildContext context,
    ExternalBrowser browser,
    Uri terms,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    if (!await browser.open(terms)) {
      messenger.showSnackBar(
        SnackBar(content: AutospacedText(messages.commonOpenLinkFailed)),
      );
    }
  }
}
