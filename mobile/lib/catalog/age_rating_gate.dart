import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';
import 'package:publira/settings/age_rating_confirmation.dart';

/// Stands where a rated series or episode body would be until this install
/// confirms the rating.
///
/// The body is not built until then, so a first-time visitor never sees the
/// synopsis, the episode list, or the pages behind the confirmation.
class AgeRatingGate extends StatelessWidget {
  const AgeRatingGate({
    super.key,
    required this.rating,
    required this.seriesTitle,
    required this.child,
  });

  /// The rating of the series being opened. Anything other than `r15` / `r18`
  /// passes [child] through.
  final SeriesAgeRating? rating;

  final String seriesTitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final confirmation = AgeRatingConfirmationScope.of(context);
    if (ageRatingMeetsConfirmation(rating, confirmation.confirmed)) {
      return child;
    }
    if (!confirmation.isRestored) {
      return const Center(
        key: ValueKey('age-rating-gate-loading'),
        child: CircularProgressIndicator(),
      );
    }
    final restricted = rating!;
    return _AgeRatingPrompt(
      rating: restricted,
      seriesTitle: seriesTitle,
      onConfirm: () {
        unawaited(confirmation.confirm(restricted));
      },
    );
  }
}

/// The confirmation itself: an [AlertDialog] in the route, not an overlay, so
/// nothing of the rated body stands behind it.
class _AgeRatingPrompt extends StatelessWidget {
  const _AgeRatingPrompt({
    required this.rating,
    required this.seriesTitle,
    required this.onConfirm,
  });

  final SeriesAgeRating rating;
  final String seriesTitle;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final isR18 = rating == SeriesAgeRating.r18;
    return Center(
      child: AlertDialog(
        key: const ValueKey('age-rating-gate'),
        title: Text(
          isR18
              ? messages.seriesAgeGateR18Title(title: seriesTitle)
              : messages.seriesAgeGateR15Title(title: seriesTitle),
        ),
        content: Text(
          isR18
              ? messages.seriesAgeGateR18Description
              : messages.seriesAgeGateR15Description,
        ),
        actions: [
          TextButton(
            key: const ValueKey('age-rating-cancel'),
            onPressed: () => _dismiss(context),
            child: Text(messages.commonCancel),
          ),
          FilledButton(
            key: const ValueKey('age-rating-confirm'),
            onPressed: onConfirm,
            child: Text(
              isR18
                  ? messages.seriesAgeGateConfirmR18
                  : messages.seriesAgeGateConfirmR15,
            ),
          ),
        ],
      ),
    );
  }

  void _dismiss(BuildContext context) {
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.go(AppRoutes.catalog);
  }
}
