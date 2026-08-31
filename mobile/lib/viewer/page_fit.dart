import 'dart:math' as math;
import 'dart:ui';

/// Box one page occupies inside [viewport] once it is scaled to fit whole.
///
/// The reader reserves this box before the image is fetched, so the loading
/// and error states stand where the page will stand and the layout does not
/// jump when the bytes arrive. It is the same fit `BoxFit.contain` applies to
/// the decoded image, computed from the size the API reported.
///
/// A page with no stored size (`0`, a record written before the size columns)
/// gets the whole viewport: the decoded image shrinks into it, which is the
/// honest placeholder when the shape is not knowable yet.
Size fitPageSize({required Size viewport, required Size page}) {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return Size.zero;
  }
  if (page.width <= 0 || page.height <= 0) {
    return viewport;
  }
  final scale = math.min(
    viewport.width / page.width,
    viewport.height / page.height,
  );
  return Size(page.width * scale, page.height * scale);
}
