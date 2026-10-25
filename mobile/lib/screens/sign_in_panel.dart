import 'package:flutter/material.dart';
import 'package:publira/tenant/tenant_brand_controller.dart';

/// The narrowest room the sign-in screen sets its panel beside the form in
/// rather than above it, which is where Material's expanded window size class
/// begins.
///
/// Half of anything narrower leaves the form less room than a phone held
/// upright gives it.
const signInPanelBesideWidth = 840.0;

/// How tall the panel is drawn above the form: enough to read as the tenant's
/// picture, and little enough that the first field is still on a phone held
/// on its side.
const signInPanelBandHeight = 160.0;

/// What the sign-in screen sets its form against: the tenant's sign-in image,
/// or its colours while it has none.
///
/// The panel is decoration. It carries no copy and is left out of the
/// semantics tree, so a screen reader goes straight to the form.
class SignInPanel extends StatelessWidget {
  const SignInPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final tenant = TenantBrandScope.maybeOf(context);
    final image = tenant?.brand?.signInImage;
    const ground = _SignInPanelGround();
    return ExcludeSemantics(
      child: ClipRect(
        child: image == null
            ? ground
            : Image.network(
                image.url.toString(),
                key: const ValueKey('sign-in-panel-image'),
                headers: tenant?.imageRequestHeaders,
                fit: BoxFit.cover,
                width: double.infinity,
                height: double.infinity,
                excludeFromSemantics: true,
                // The tenant's colours stand in until the image arrives, and
                // for good when it cannot, which is the case on a launch
                // without a network.
                frameBuilder: (context, child, frame, wasSynchronouslyLoaded) =>
                    frame == null ? ground : child,
                errorBuilder: (context, error, stackTrace) => ground,
              ),
      ),
    );
  }
}

/// The tenant's primary colour, ruled into even squares in the colour the
/// tenant sets text on that primary in — the same ground the public site's
/// panel falls back to.
///
/// The pair is one the tenant already chose to read against each other, which
/// is what keeps the rules visible without a contrast decision being made
/// here.
class _SignInPanelGround extends StatelessWidget {
  const _SignInPanelGround();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return CustomPaint(
      key: const ValueKey('sign-in-panel-ground'),
      painter: _RulePainter(
        ground: colors.primary,
        rule: colors.onPrimary.withValues(alpha: 0.16),
      ),
      child: const SizedBox.expand(),
    );
  }
}

class _RulePainter extends CustomPainter {
  const _RulePainter({required this.ground, required this.rule});

  /// The side of one square, the web panel's `1.5rem`.
  static const _spacing = 24.0;

  final Color ground;
  final Color rule;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = ground);
    final paint = Paint()..color = rule;
    for (var x = 0.0; x < size.width; x += _spacing) {
      canvas.drawRect(Rect.fromLTWH(x, 0, 1, size.height), paint);
    }
    for (var y = 0.0; y < size.height; y += _spacing) {
      canvas.drawRect(Rect.fromLTWH(0, y, size.width, 1), paint);
    }
  }

  @override
  bool shouldRepaint(_RulePainter oldDelegate) =>
      ground != oldDelegate.ground || rule != oldDelegate.rule;
}
