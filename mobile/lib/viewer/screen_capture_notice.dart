import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/tenant/tenant_brand_controller.dart';
import 'package:publira/viewer/screen_captures.dart';

/// Answers a screenshot of [episodeId]'s pages with a notice over [child]
/// saying how the pages may be used, once per episode per run of the app.
///
/// The notice changes nothing else: the pages stay as they are, and the
/// reader keeps turning them underneath it until they close it.
class ScreenCaptureNotice extends StatefulWidget {
  const ScreenCaptureNotice({
    super.key,
    required this.episodeId,
    required this.child,
  });

  final String episodeId;
  final Widget child;

  @override
  State<ScreenCaptureNotice> createState() => _ScreenCaptureNoticeState();
}

class _ScreenCaptureNoticeState extends State<ScreenCaptureNotice> {
  ScreenCaptureNotices? _notices;
  StreamSubscription<void>? _subscription;
  var _showing = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final notices = ScreenCaptureScope.maybeOf(context);
    if (notices == _notices) {
      return;
    }
    unawaited(_subscription?.cancel());
    _notices = notices;
    _subscription = notices?.captures.captures.listen((_) => _onCapture());
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  void _onCapture() {
    // A viewer on a tab left behind, or under the comments pushed over it,
    // is still mounted but is not what was captured.
    if (!AppTabScope.isActive(context) ||
        !(ModalRoute.isCurrentOf(context) ?? true)) {
      return;
    }
    if (!_notices!.claim(widget.episodeId)) {
      return;
    }
    setState(() {
      _showing = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (_showing)
          Positioned(
            top: 8,
            left: 8,
            right: 8,
            child: _Notice(
              onDismiss: () => setState(() {
                _showing = false;
              }),
            ),
          ),
      ],
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.onDismiss});

  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final tenant = TenantBrandScope.maybeOf(context)?.brand?.name ?? '';
    return Semantics(
      liveRegion: true,
      child: Material(
        key: const ValueKey('episode-capture-notice'),
        color: colors.inverseSurface,
        elevation: 3,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(16, 4, 4, 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  tenant.isEmpty
                      ? messages.viewerCaptureNoticeBodyUnnamed
                      : messages.viewerCaptureNoticeBody(tenant: tenant),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colors.onInverseSurface,
                  ),
                ),
              ),
              IconButton(
                key: const ValueKey('episode-capture-notice-dismiss'),
                icon: const Icon(Icons.close),
                color: colors.onInverseSurface,
                tooltip: messages.viewerCaptureNoticeDismiss,
                onPressed: onDismiss,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
