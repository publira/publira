package adminapi

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"testing"

	"github.com/publira/publira/server/internal/imageproc"
)

// halvedImage encodes a width x height PNG whose left half is one colour and
// whose right half is another, so a test can tell which part of it survived a
// crop by reading a pixel.
func halvedImage(t *testing.T, width, height int, left, right color.RGBA) []byte {
	t.Helper()

	src := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			if x < width/2 {
				src.Set(x, y, left)
				continue
			}
			src.Set(x, y, right)
		}
	}

	var raw bytes.Buffer
	if err := png.Encode(&raw, src); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return raw.Bytes()
}

func TestNormalizeCreatorIconImageCenterCropSquare(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 400, 300))
	left := color.RGBA{R: 255, A: 255}
	center := color.RGBA{G: 255, A: 255}
	right := color.RGBA{B: 255, A: 255}

	for y := 0; y < 300; y++ {
		for x := 0; x < 400; x++ {
			switch {
			case x < 100:
				src.Set(x, y, left)
			case x < 300:
				src.Set(x, y, center)
			default:
				src.Set(x, y, right)
			}
		}
	}

	var raw bytes.Buffer
	if err := png.Encode(&raw, src); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}

	normalized, err := normalizeCreatorIconImage(raw.Bytes(), "image/png", nil)
	if err != nil {
		t.Fatalf("normalizeCreatorIconImage: %v", err)
	}
	if normalized == nil {
		t.Fatalf("normalized image is nil")
	}
	if normalized.Width != 300 || normalized.Height != 300 {
		t.Fatalf("size = %dx%d, want 300x300", normalized.Width, normalized.Height)
	}
	if normalized.ContentType != "image/png" {
		t.Fatalf("content type = %q, want image/png", normalized.ContentType)
	}

	decoded, _, err := image.Decode(bytes.NewReader(normalized.Data))
	if err != nil {
		t.Fatalf("image.Decode: %v", err)
	}
	bounds := decoded.Bounds()
	if bounds.Dx() != 300 || bounds.Dy() != 300 {
		t.Fatalf("decoded size = %dx%d, want 300x300", bounds.Dx(), bounds.Dy())
	}

	leftPixel := color.RGBAModel.Convert(decoded.At(0, 0)).(color.RGBA)
	if leftPixel != left {
		t.Fatalf("left-edge pixel = %+v, want %+v", leftPixel, left)
	}
	centerPixel := color.RGBAModel.Convert(decoded.At(150, 150)).(color.RGBA)
	if centerPixel != center {
		t.Fatalf("center pixel = %+v, want %+v", centerPixel, center)
	}
	rightPixel := color.RGBAModel.Convert(decoded.At(299, 0)).(color.RGBA)
	if rightPixel != right {
		t.Fatalf("right-edge pixel = %+v, want %+v", rightPixel, right)
	}
}

func TestNormalizeCreatorIconImageCutsAtTheCropRectangle(t *testing.T) {
	left := color.RGBA{R: 255, A: 255}
	right := color.RGBA{B: 255, A: 255}
	// The centre square of a 600x400 image is 400x400 at x=100, which straddles
	// the two halves. A rectangle in the right half therefore proves the cut
	// was taken where it was asked for rather than in the centre.
	raw := halvedImage(t, 600, 400, left, right)

	normalized, err := normalizeCreatorIconImage(raw, "image/png", &imageproc.CropRect{X: 300, Y: 50, Width: 300, Height: 300})
	if err != nil {
		t.Fatalf("normalizeCreatorIconImage: %v", err)
	}
	if normalized.Width != 300 || normalized.Height != 300 {
		t.Fatalf("size = %dx%d, want 300x300", normalized.Width, normalized.Height)
	}

	decoded, _, err := image.Decode(bytes.NewReader(normalized.Data))
	if err != nil {
		t.Fatalf("image.Decode: %v", err)
	}
	for _, point := range []image.Point{{X: 0, Y: 0}, {X: 299, Y: 299}} {
		pixel := color.RGBAModel.Convert(decoded.At(point.X, point.Y)).(color.RGBA)
		if pixel != right {
			t.Fatalf("pixel at %v = %+v, want %+v", point, pixel, right)
		}
	}
}

func TestNormalizeCreatorIconImageFitsASquareInsideTheCropRectangle(t *testing.T) {
	left := color.RGBA{R: 255, A: 255}
	right := color.RGBA{B: 255, A: 255}
	raw := halvedImage(t, 600, 400, left, right)

	normalized, err := normalizeCreatorIconImage(raw, "image/png", &imageproc.CropRect{X: 100, Y: 0, Width: 400, Height: 300})
	if err != nil {
		t.Fatalf("normalizeCreatorIconImage: %v", err)
	}
	if normalized.Width != 300 || normalized.Height != 300 {
		t.Fatalf("size = %dx%d, want 300x300", normalized.Width, normalized.Height)
	}
}

func TestNormalizeCreatorIconImageRejectsACropOutsideTheImage(t *testing.T) {
	raw := halvedImage(t, 600, 400, color.RGBA{R: 255, A: 255}, color.RGBA{B: 255, A: 255})

	_, err := normalizeCreatorIconImage(raw, "image/png", &imageproc.CropRect{X: 400, Y: 0, Width: 300, Height: 300})
	if !errors.Is(err, imageproc.ErrInvalidCrop) {
		t.Fatalf("error = %v, want an ErrInvalidCrop", err)
	}
}

func TestNormalizeCreatorIconImageRejectsACropBelowTheMinimum(t *testing.T) {
	raw := halvedImage(t, 600, 400, color.RGBA{R: 255, A: 255}, color.RGBA{B: 255, A: 255})

	// The image itself is large enough, so the rectangle is what the editor
	// has to change.
	_, err := normalizeCreatorIconImage(raw, "image/png", &imageproc.CropRect{X: 0, Y: 0, Width: 200, Height: 200})
	if !errors.Is(err, imageproc.ErrInvalidCrop) {
		t.Fatalf("error = %v, want an ErrInvalidCrop", err)
	}
}
