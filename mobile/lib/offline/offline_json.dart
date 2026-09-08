import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';

/// Layout of what the library writes. A file written under another number is
/// dropped rather than read, so a shape change costs the saved episodes and
/// never a failed launch. It also covers the shape of the files themselves:
/// version 2 is where every write started carrying its own nonce.
const offlineIndexVersion = 2;

/// The whole of one device's saved metadata: the catalog snapshot, the series
/// screens behind it, and the episodes whose pages are on disk.
///
/// It is one document because it is small — the byte limit keeps the device to
/// a few dozen episodes — and because eviction has to see every episode at
/// once to decide which to drop.
class OfflineIndex {
  OfflineIndex({
    this.series,
    Map<String, SeriesDetail>? details,
    Map<String, SavedEpisode>? episodes,
    Map<String, SavedReadingPosition>? positions,
  }) : details = details ?? <String, SeriesDetail>{},
       episodes = episodes ?? <String, SavedEpisode>{},
       positions = positions ?? <String, SavedReadingPosition>{};

  /// Catalog list as it last loaded, or `null` when it never has.
  List<SeriesItem>? series;

  /// Series screens, keyed by public id.
  final Map<String, SeriesDetail> details;

  /// Saved episodes, keyed by [savedEpisodeKey].
  final Map<String, SavedEpisode> episodes;

  /// Where the reader stopped, keyed by [savedEpisodeKey] like the episodes
  /// the positions point into.
  final Map<String, SavedReadingPosition> positions;

  Map<String, Object?> toJson() => {
    'version': offlineIndexVersion,
    if (series != null)
      'series': [for (final item in series!) _seriesToJson(item)],
    'details': {
      for (final entry in details.entries)
        entry.key: _seriesDetailToJson(entry.value),
    },
    'episodes': {
      for (final entry in episodes.entries)
        entry.key: _savedEpisodeToJson(entry.value),
    },
    'positions': {
      for (final entry in positions.entries)
        entry.key: _positionToJson(entry.value),
    },
  };

  /// Reads an index written by [toJson], or `null` for anything this build
  /// cannot read.
  static OfflineIndex? fromJson(Object? decoded) {
    if (decoded is! Map || decoded['version'] != offlineIndexVersion) {
      return null;
    }
    final rawSeries = decoded['series'];
    final rawDetails = decoded['details'];
    final rawEpisodes = decoded['episodes'];
    final rawPositions = decoded['positions'];
    return OfflineIndex(
      positions: rawPositions is! Map
          ? null
          : {
              for (final entry in rawPositions.entries)
                entry.key.toString(): ?_positionFromJson(entry.value),
            },
      series: rawSeries is List
          ? [for (final item in rawSeries) ?_seriesFromJson(item)]
          : null,
      details: rawDetails is! Map
          ? null
          : {
              for (final entry in rawDetails.entries)
                entry.key.toString(): ?_seriesDetailFromJson(entry.value),
            },
      episodes: rawEpisodes is! Map
          ? null
          : {
              for (final entry in rawEpisodes.entries)
                entry.key.toString(): ?_savedEpisodeFromJson(entry.value),
            },
    );
  }
}

// The request headers are left out the way a body page's are: they name the
// tenant this build was pointed at rather than anything the API said, and the
// screen that reads a saved series has the live ones in hand.
Map<String, Object?> _seriesToJson(SeriesItem series) => {
  'id': series.id,
  'title': series.title,
  'description': series.description,
  'episodeCount': series.episodeCount,
  'labelName': series.labelName,
  'eyeCatchVariants': [
    for (final variant in series.eyeCatchVariants) _variantToJson(variant),
  ],
};

SeriesItem? _seriesFromJson(Object? decoded) {
  if (decoded is! Map) {
    return null;
  }
  final id = _string(decoded['id']);
  if (id.isEmpty) {
    return null;
  }
  final rawVariants = decoded['eyeCatchVariants'];
  return SeriesItem(
    id: id,
    title: _string(decoded['title']),
    description: _string(decoded['description']),
    episodeCount: _int(decoded['episodeCount']),
    labelName: _string(decoded['labelName']),
    eyeCatchVariants: [
      for (final item in rawVariants is List ? rawVariants : const [])
        ?_variantFromJson(item),
    ],
  );
}

Map<String, Object?> _variantToJson(EyeCatchVariant variant) => {
  'variantType': variant.variantType,
  'url': variant.url.toString(),
  'width': variant.width,
  'height': variant.height,
};

EyeCatchVariant? _variantFromJson(Object? decoded) {
  if (decoded is! Map) {
    return null;
  }
  final rawUrl = _string(decoded['url']);
  final url = rawUrl.isEmpty ? null : Uri.tryParse(rawUrl);
  // A cover is written down already resolved against the image base, so a
  // relative reference is a record this build cannot address; keeping it would
  // spend a failed request to arrive at the placeholder it starts as.
  if (url == null || !url.isAbsolute) {
    return null;
  }
  return EyeCatchVariant(
    variantType: _string(decoded['variantType']),
    url: url,
    width: _int(decoded['width']),
    height: _int(decoded['height']),
  );
}

Map<String, Object?> _episodeToJson(EpisodeItem episode) => {
  'id': episode.id,
  'title': episode.title,
  'orderIndex': episode.orderIndex,
  'price': episode.price,
};

EpisodeItem? _episodeFromJson(Object? decoded) {
  if (decoded is! Map) {
    return null;
  }
  final id = _string(decoded['id']);
  if (id.isEmpty) {
    return null;
  }
  return EpisodeItem(
    id: id,
    title: _string(decoded['title']),
    orderIndex: _int(decoded['orderIndex']),
    price: _int(decoded['price']),
  );
}

Map<String, Object?> _seriesDetailToJson(SeriesDetail detail) => {
  'series': _seriesToJson(detail.series),
  'episodes': [for (final episode in detail.episodes) _episodeToJson(episode)],
};

SeriesDetail? _seriesDetailFromJson(Object? decoded) {
  if (decoded is! Map) {
    return null;
  }
  final series = _seriesFromJson(decoded['series']);
  if (series == null) {
    return null;
  }
  final rawEpisodes = decoded['episodes'];
  return SeriesDetail(
    series: series,
    episodes: rawEpisodes is! List
        ? const []
        : [for (final item in rawEpisodes) ?_episodeFromJson(item)],
  );
}

Map<String, Object?> _imageToJson(EpisodeImageItem image) => {
  'id': image.id,
  'url': image.url.toString(),
  'displayOrder': image.displayOrder,
  'width': image.width,
  'height': image.height,
};

EpisodeImageItem? _imageFromJson(Object? decoded) {
  if (decoded is! Map) {
    return null;
  }
  final id = _string(decoded['id']);
  final url = Uri.tryParse(_string(decoded['url']));
  if (id.isEmpty || url == null) {
    return null;
  }
  return EpisodeImageItem(
    id: id,
    url: url,
    displayOrder: _int(decoded['displayOrder']),
    width: _int(decoded['width']),
    height: _int(decoded['height']),
  );
}

Map<String, Object?> _savedEpisodeToJson(SavedEpisode saved) {
  final detail = saved.detail;
  return {
    'ownerId': saved.ownerId,
    'checkedAt': saved.checkedAt.toUtc().toIso8601String(),
    'seriesId': detail.seriesId,
    'seriesTitle': detail.seriesTitle,
    'access': detail.access.name,
    'episode': _episodeToJson(detail.episode),
    'images': [for (final image in detail.images) _imageToJson(image)],
  };
}

SavedEpisode? _savedEpisodeFromJson(Object? decoded) {
  if (decoded is! Map) {
    return null;
  }
  final seriesId = _string(decoded['seriesId']);
  final episode = _episodeFromJson(decoded['episode']);
  final checkedAt = DateTime.tryParse(_string(decoded['checkedAt']));
  if (seriesId.isEmpty || episode == null || checkedAt == null) {
    return null;
  }
  final access = _accessFromName(_string(decoded['access']));
  final ownerId = _string(decoded['ownerId']);
  // An empty owner is what marks a free body, and a free body opens on a
  // signed-out device. A record that needed a grant but names nobody is
  // therefore not a record to read leniently: dropping it costs one refetch,
  // reading it hands a paid body to whoever is holding the phone.
  if (access != EpisodeAccess.free && ownerId.isEmpty) {
    return null;
  }
  final rawImages = decoded['images'];
  return SavedEpisode(
    ownerId: ownerId,
    checkedAt: checkedAt.toUtc(),
    detail: EpisodeDetail(
      episode: episode,
      seriesId: seriesId,
      seriesTitle: _string(decoded['seriesTitle']),
      access: access,
      images: [
        for (final item in rawImages is List ? rawImages : const [])
          ?_imageFromJson(item),
      ],
    ),
  );
}

Map<String, Object?> _positionToJson(SavedReadingPosition position) => {
  'readerId': position.readerId,
  'pageIndex': position.pageIndex,
};

SavedReadingPosition? _positionFromJson(Object? decoded) {
  if (decoded is! Map) {
    return null;
  }
  final readerId = _string(decoded['readerId']);
  final pageIndex = decoded['pageIndex'];
  // A position nobody is named in is one no reader can be answered with, and
  // a page before the first is not a page of the episode.
  if (readerId.isEmpty || pageIndex is! int || pageIndex < 0) {
    return null;
  }
  return SavedReadingPosition(readerId: readerId, pageIndex: pageIndex);
}

EpisodeAccess _accessFromName(String name) {
  for (final access in EpisodeAccess.values) {
    if (access.name == name) {
      return access;
    }
  }
  return EpisodeAccess.unknown;
}

String _string(Object? value) => value is String ? value : '';

int _int(Object? value) => value is int ? value : 0;
