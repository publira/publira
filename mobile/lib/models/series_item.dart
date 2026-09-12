/// One stored rendition of a series eye-catch image, as
/// `publira.types.v1.SeriesEyeCatchVariant` describes it.
///
/// The renditions of one series are independent images rather than sizes cut
/// from a master, so a series may carry some aspect ratios and not others.
class EyeCatchVariant {
  const EyeCatchVariant({
    required this.variantType,
    required this.url,
    required this.width,
    required this.height,
  });

  /// What the rendition is cut for: `portrait`, `square`, `landscape`, or
  /// `og`.
  final String variantType;

  /// Absolute image-server URL, already resolved against the configured image
  /// base.
  final Uri url;

  /// Stored pixel size, which is what a screen picks a rendition by.
  final int width;
  final int height;
}

/// One person credited on a series, as `publira.types.v1.Creator` describes
/// them.
class SeriesCreator {
  const SeriesCreator({required this.id, required this.name});

  /// Public id (`public_id`), which addresses the creator.
  final String id;
  final String name;
}

/// Whether a series is still gaining episodes, as
/// `publira.types.v1.SeriesStatus` names them.
///
/// `null` on [SeriesItem.status] is a series the tenant has not classified,
/// which a screen says nothing about rather than wording as unknown.
enum SeriesStatus { ongoing, completed, hiatus }

/// Who a series is meant for, as `publira.types.v1.SeriesAgeRating` names
/// them.
///
/// `all` and `null` on [SeriesItem.ageRating] carry no badge and no
/// confirmation. [r15] and [r18] do, and a confirmation of [r18] covers
/// [r15] as well. [unknown] is a name this build does not know, which still
/// closes the body: a future rating must not open as unrestricted.
enum SeriesAgeRating { all, r15, r18, unknown }

/// Whether [rating] is one a reader has to confirm before the pages open.
bool isRestrictedAgeRating(SeriesAgeRating? rating) =>
    rating == SeriesAgeRating.r15 ||
    rating == SeriesAgeRating.r18 ||
    rating == SeriesAgeRating.unknown;

/// What this install has confirmed: the highest named restricted rating, and
/// whether an unrecognized rating has been confirmed on its own.
///
/// An unrecognized rating is not on the R15/R18 ladder. Confirming `r18`
/// does not cover it, and confirming it does not cover `r15`.
class AgeRatingConfirmation {
  const AgeRatingConfirmation({this.named, this.unknown = false});

  static const empty = AgeRatingConfirmation();

  /// `r15` or `r18`, the highest named rating confirmed. `null` when neither
  /// has been.
  final SeriesAgeRating? named;

  /// Whether the reader has confirmed a rating this build does not know.
  final bool unknown;

  bool get isEmpty => named == null && !unknown;

  /// Whether a stored confirmation is enough for [required]. Confirming
  /// `r18` covers `r15`; confirming `r15` does not open an `r18` series;
  /// an unrecognized rating is covered only by its own confirmation.
  bool covers(SeriesAgeRating? required) {
    return switch (required) {
      null || SeriesAgeRating.all => true,
      SeriesAgeRating.r15 =>
        named == SeriesAgeRating.r15 || named == SeriesAgeRating.r18,
      SeriesAgeRating.r18 => named == SeriesAgeRating.r18,
      SeriesAgeRating.unknown => unknown,
    };
  }

  /// The confirmation after [rating] is recorded, keeping an `r18` already
  /// stored rather than lowering it to `r15`.
  AgeRatingConfirmation confirming(SeriesAgeRating rating) {
    return switch (rating) {
      SeriesAgeRating.unknown => AgeRatingConfirmation(
        named: named,
        unknown: true,
      ),
      SeriesAgeRating.r15 || SeriesAgeRating.r18 => AgeRatingConfirmation(
        named: maxRestrictedAgeRating(named, rating),
        unknown: unknown,
      ),
      SeriesAgeRating.all => this,
    };
  }

  @override
  bool operator ==(Object other) =>
      other is AgeRatingConfirmation &&
      named == other.named &&
      unknown == other.unknown;

  @override
  int get hashCode => Object.hash(named, unknown);
}

/// Whether a stored confirmation is enough for [required].
bool ageRatingMeetsConfirmation(
  SeriesAgeRating? required,
  AgeRatingConfirmation confirmed,
) => confirmed.covers(required);

/// The higher of two named restricted ratings, so confirming `r18` later
/// cannot be overwritten by confirming `r15`. Unrecognized ratings are not
/// on this ladder and are ignored.
SeriesAgeRating? maxRestrictedAgeRating(
  SeriesAgeRating? current,
  SeriesAgeRating next,
) {
  if (current == SeriesAgeRating.r18 || next == SeriesAgeRating.r18) {
    return SeriesAgeRating.r18;
  }
  if (current == SeriesAgeRating.r15 || next == SeriesAgeRating.r15) {
    return SeriesAgeRating.r15;
  }
  return null;
}

/// One genre a series carries, as `publira.types.v1.Genre` describes it, in
/// the tenant's genre order.
class SeriesGenre {
  const SeriesGenre({required this.id, required this.name});

  /// Public id (`public_id`), which addresses the genre.
  final String id;
  final String name;
}

/// A published series as shown on the catalog list and detail screens.
class SeriesItem {
  const SeriesItem({
    required this.id,
    required this.title,
    required this.description,
    this.episodeCount = 0,
    this.labelName = '',
    this.creators = const [],
    this.eyeCatchVariants = const [],
    this.imageRequestHeaders = const {},
    this.status,
    this.scheduleWeekdays = const [],
    this.ageRating,
    this.genres = const [],
  });

  /// Public id (`public_id`), used as the route parameter.
  final String id;
  final String title;
  final String description;
  final int episodeCount;
  final String labelName;

  /// Who is credited on the series, in the order the API returned them, which
  /// is the order the tenant put them in. Empty for a series credited to
  /// nobody, which leaves the line off the screen entirely.
  final List<SeriesCreator> creators;

  /// Cover renditions in the order the API returned them. Empty for a series
  /// with no eye-catch, which is what puts the placeholder on screen.
  final List<EyeCatchVariant> eyeCatchVariants;

  /// Headers [eyeCatchVariants] must be fetched with. They travel with the
  /// series because the same read resolved both the URLs and the tenant they
  /// address.
  final Map<String, String> imageRequestHeaders;

  /// Whether the series is still gaining episodes. `null` when the tenant has
  /// not said.
  final SeriesStatus? status;

  /// The weekdays a new episode is expected, as `EXTRACT(DOW)` numbers: 0 is
  /// Sunday and 6 is Saturday. Empty is a series that keeps no weekly
  /// schedule, which the screen says nothing about.
  final List<int> scheduleWeekdays;

  /// Who the series is meant for. `null` and [SeriesAgeRating.all] are the
  /// same on screen: no badge and no confirmation. [SeriesAgeRating.unknown]
  /// still waits for confirmation, without a named badge.
  final SeriesAgeRating? ageRating;

  /// The tenant's genres this series carries, in the tenant's genre order.
  /// Empty for a series in none of them.
  final List<SeriesGenre> genres;

  /// The same series with a different episode count or image-request headers.
  ///
  /// Both are decided after the series is read — the episode list on a detail
  /// page, the live tenant headers on a saved catalog — so they are put on
  /// here rather than by reconstructing every other field.
  SeriesItem copyWith({
    int? episodeCount,
    Map<String, String>? imageRequestHeaders,
  }) {
    return SeriesItem(
      id: id,
      title: title,
      description: description,
      episodeCount: episodeCount ?? this.episodeCount,
      labelName: labelName,
      creators: creators,
      eyeCatchVariants: eyeCatchVariants,
      imageRequestHeaders: imageRequestHeaders ?? this.imageRequestHeaders,
      status: status,
      scheduleWeekdays: scheduleWeekdays,
      ageRating: ageRating,
      genres: genres,
    );
  }
}

/// One published episode on a series detail page.
class EpisodeItem {
  const EpisodeItem({
    required this.id,
    required this.title,
    required this.orderIndex,
    required this.price,
  });

  final String id;
  final String title;
  final int orderIndex;
  final int price;
}

/// Series plus its published episodes.
class SeriesDetail {
  const SeriesDetail({required this.series, required this.episodes});

  final SeriesItem series;
  final List<EpisodeItem> episodes;
}

/// One offer in the reader's continue-reading row, as `RecentSeries`
/// describes it.
class RecentSeriesItem {
  const RecentSeriesItem({required this.series, required this.episode});

  final SeriesItem series;

  /// The episode to open: the one the reader last moved in while it is still
  /// unfinished, and otherwise the next published one they have not finished.
  /// It is offered whatever they may do with its body, so a paid episode they
  /// have not bought is the episode they are sent to buy.
  final EpisodeItem episode;
}

/// The window one ranking snapshot covers, as `publira.v1.RankingPeriod` names
/// them. The batch writes a snapshot per window on every run, so a tenant it
/// has ranked has both.
enum RankingPeriod { daily, weekly }

/// One series at the position a ranking snapshot gave it, as
/// `publira.v1.RankedSeries` describes it.
class RankedSeriesItem {
  const RankedSeriesItem({required this.rank, required this.series});

  /// The position in the snapshot, counting from 1. The positions are the
  /// snapshot's own, so a series unpublished since it was written leaves a gap
  /// and a page can run 1, 2, 4.
  final int rank;

  final SeriesItem series;
}
