import 'package:material_ui/material_ui.dart';
import 'package:qr/qr.dart';

/// [data] drawn as a QR code [size] logical pixels wide, for a camera on
/// another device to read.
///
/// Always dark modules on white with the four-module quiet zone the standard
/// asks for, whatever the theme: a code inverted for a dark theme is one many
/// readers do not find.
class QrCodeImage extends StatelessWidget {
  const QrCodeImage({
    super.key,
    required this.data,
    required this.semanticLabel,
    this.size = 200,
  });

  final String data;
  final String semanticLabel;
  final double size;

  @override
  Widget build(BuildContext context) {
    final image = QrImage(QrCode(payload: QrPayload.fromString(data)));
    return Semantics(
      label: semanticLabel,
      image: true,
      child: ExcludeSemantics(
        child: CustomPaint(size: Size.square(size), painter: _QrPainter(image)),
      ),
    );
  }
}

class _QrPainter extends CustomPainter {
  _QrPainter(this.image);

  final QrImage image;

  static const _quietZone = 4;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = Colors.white);
    final modules = image.moduleCount + _quietZone * 2;
    final module = size.shortestSide / modules;
    final dark = Paint()
      ..color = Colors.black
      ..isAntiAlias = false;
    for (var row = 0; row < image.moduleCount; row++) {
      for (var col = 0; col < image.moduleCount; col++) {
        if (image.isDark(row, col)) {
          canvas.drawRect(
            Rect.fromLTWH(
              (col + _quietZone) * module,
              (row + _quietZone) * module,
              // Overlapping by a hair, so no seam of the background shows
              // between neighbours where the module width is fractional.
              module + 0.5,
              module + 0.5,
            ),
            dark,
          );
        }
      }
    }
  }

  @override
  bool shouldRepaint(_QrPainter oldDelegate) => oldDelegate.image != image;
}
