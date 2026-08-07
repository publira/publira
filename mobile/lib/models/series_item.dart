/// Placeholder catalog item used until public API integration lands.
class SeriesItem {
  const SeriesItem({
    required this.id,
    required this.title,
    required this.description,
    required this.episodeCount,
  });

  final String id;
  final String title;
  final String description;
  final int episodeCount;
}
