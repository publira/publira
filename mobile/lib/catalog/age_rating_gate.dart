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

  /// The rating of the series being opened. Unspecified and all-ages pass
  /// [child] through; `r15`, `r18`, and a name this build does not know wait
  /// for confirmation.
  final SeriesAgeRating? rating;

  final String seriesTitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final confirmation = AgeRatingConfirmationScope.of(context);
    if (confirmation.confirmed.covers(rating)) {
      return child;
    }
    if (!confirmation.isRestored) {
      return const Center(
        key: ValueKey('age-rating-gate-loading'),
        child: CircularProgressIndicator(),
      );
    }
    return _AgeRatingPrompt(rating: rating!, seriesTitle: seriesTitle);
  }
}

/// The confirmation itself: an [AlertDialog] in the route, not an overlay, so
/// nothing of the rated body stands behind it.
class _AgeRatingPrompt extends StatefulWidget {
  const _AgeRatingPrompt({required this.rating, required this.seriesTitle});

  final SeriesAgeRating rating;
  final String seriesTitle;

  @override
  State<_AgeRatingPrompt> createState() => _AgeRatingPromptState();
}

class _AgeRatingPromptState extends State<_AgeRatingPrompt> {
  var _busy = false;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Center(
      child: AlertDialog(
        key: const ValueKey('age-rating-gate'),
        title: Text(_title(messages)),
        content: Text(_description(messages)),
        actions: [
          TextButton(
            key: const ValueKey('age-rating-cancel'),
            onPressed: _busy ? null : () => _dismiss(context),
            child: Text(messages.commonCancel),
          ),
          FilledButton(
            key: const ValueKey('age-rating-confirm'),
            onPressed: _busy ? null : _confirm,
            child: Text(_confirmLabel(messages)),
          ),
        ],
      ),
    );
  }

  String _title(AppMessages messages) {
    return switch (widget.rating) {
      SeriesAgeRating.r18 => messages.seriesAgeGateR18Title(
        title: widget.seriesTitle,
      ),
      SeriesAgeRating.unknown => messages.seriesAgeGateUnknownTitle(
        title: widget.seriesTitle,
      ),
      SeriesAgeRating.r15 || SeriesAgeRating.all =>
        messages.seriesAgeGateR15Title(title: widget.seriesTitle),
    };
  }

  String _description(AppMessages messages) {
    return switch (widget.rating) {
      SeriesAgeRating.r18 => messages.seriesAgeGateR18Description,
      SeriesAgeRating.unknown => messages.seriesAgeGateUnknownDescription,
      SeriesAgeRating.r15 ||
      SeriesAgeRating.all => messages.seriesAgeGateR15Description,
    };
  }

  String _confirmLabel(AppMessages messages) {
    return switch (widget.rating) {
      SeriesAgeRating.r18 => messages.seriesAgeGateConfirmR18,
      SeriesAgeRating.unknown => messages.seriesAgeGateConfirmUnknown,
      SeriesAgeRating.r15 ||
      SeriesAgeRating.all => messages.seriesAgeGateConfirmR15,
    };
  }

  Future<void> _confirm() async {
    setState(() {
      _busy = true;
    });
    try {
      await AgeRatingConfirmationScope.of(context).confirm(widget.rating);
    } catch (_) {
      // The write did not land, so the controller still holds the previous
      // confirmation and this prompt stays. The button can be pressed again.
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  void _dismiss(BuildContext context) {
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.go(AppRoutes.catalog);
  }
}
