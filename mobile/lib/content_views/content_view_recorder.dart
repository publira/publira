import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:publira/content_views/content_view_repository.dart';

/// Records one view of the page [child] shows, the first time it is on
/// screen.
///
/// Placed where the page's content is, so a view is counted only once a reader
/// actually sees it: a screen still loading, missing, or stopped at the age
/// rating gate records nothing, as the storefront's page does not.
class ContentViewRecorder extends StatefulWidget {
  const ContentViewRecorder({
    super.key,
    required this.kind,
    required this.publicId,
    required this.child,
  });

  final ContentViewKind kind;
  final String publicId;
  final Widget child;

  @override
  State<ContentViewRecorder> createState() => _ContentViewRecorderState();
}

class _ContentViewRecorderState extends State<ContentViewRecorder> {
  var _recorded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // A route under another one is built without being seen: the series
    // screen go_router stacks beneath an episode opened from a link. Looking
    // the route up also brings this back here once it comes to the front.
    if (_recorded || !(ModalRoute.of(context)?.isCurrent ?? true)) {
      return;
    }
    _recorded = true;
    _record();
  }

  @override
  void didUpdateWidget(ContentViewRecorder oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.kind != oldWidget.kind ||
        widget.publicId != oldWidget.publicId) {
      _record();
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;

  void _record() {
    final repository = ContentViewScope.maybeOf(context);
    if (repository == null) {
      return;
    }
    unawaited(_send(repository, widget.kind, widget.publicId));
  }

  /// A view is instrumentation, so whatever the call fails with is dropped
  /// rather than shown to the reader or retried.
  Future<void> _send(
    ContentViewRepository repository,
    ContentViewKind kind,
    String publicId,
  ) async {
    try {
      await repository.record(kind, publicId);
    } catch (_) {
      // Lost, as a beacon the browser could not queue is.
    }
  }
}
