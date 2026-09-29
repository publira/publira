/// How the pages of one episode are laid out over the screens the reader turns
/// through.
///
/// A screen holds one page, or two once [paired] is on, and the reader keeps
/// its position as a page index either way: the reading position is a page of
/// the episode, not a screen of this device, so rotating a tablet moves the
/// reader between screen numbering without moving the page they are on.
class PageSpreads {
  const PageSpreads({
    required this.pageCount,
    required this.paired,
    this.spreadStartIndex = 1,
  });

  final int pageCount;

  /// Whether two pages share a screen from [spreadStartIndex] on.
  final bool paired;

  /// The page from which two pages share a screen. Every page before it
  /// stands alone. 1 is the cover standing alone, which is what a series
  /// nobody has set uses; 0 pairs from the first page.
  final int spreadStartIndex;

  /// How many screens the episode takes.
  int get length {
    if (!paired || pageCount <= spreadStartIndex) {
      return pageCount;
    }
    return spreadStartIndex + (pageCount - spreadStartIndex + 1) ~/ 2;
  }

  /// The pages screen [spread] shows, in reading order.
  ///
  /// The second page is dropped where the episode runs out, so an episode with
  /// an even page count ends on a single page rather than on a half-empty
  /// spread of one page and one blank.
  List<int> pagesAt(int spread) {
    final first = firstPageOf(spread);
    if (!paired || spread < spreadStartIndex || first + 1 >= pageCount) {
      return [first];
    }
    return [first, first + 1];
  }

  /// The first page of screen [spread] — the page its counter starts at.
  int firstPageOf(int spread) => paired && spread > spreadStartIndex
      ? spreadStartIndex + (spread - spreadStartIndex) * 2
      : spread;

  /// The screen [page] is shown on.
  int spreadOf(int page) => paired && page > spreadStartIndex
      ? spreadStartIndex + (page - spreadStartIndex) ~/ 2
      : page;
}
