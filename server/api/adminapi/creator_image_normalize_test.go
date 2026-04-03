package adminapi

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

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

	normalized, err := normalizeCreatorIconImage(raw.Bytes(), "image/png")
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
