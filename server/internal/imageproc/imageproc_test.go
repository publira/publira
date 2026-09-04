package imageproc_test

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"testing"

	"github.com/publira/publira/server/internal/imageproc"
)

// --- helpers ---

func makeJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			img.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 180, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatalf("jpeg.Encode: %v", err)
	}
	return buf.Bytes()
}

func makePNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	img.Set(0, 0, color.RGBA{R: 255, G: 0, B: 0, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

// --- TestBuildVariants ---

func TestBuildVariants_SmallImage_ReturnsOriginalOnly(t *testing.T) {
	// 200 px is no wider than any target width (480/960/1440), so the source
	// size is the only variant.
	raw := makePNG(t, 200, 150)
	variants, err := imageproc.BuildVariants(raw, "image/png")
	if err != nil {
		t.Fatalf("BuildVariants: %v", err)
	}
	if len(variants) != 1 {
		t.Fatalf("got %d variants, want 1", len(variants))
	}
	v := variants[0]
	if v.Width != 200 || v.Height != 150 {
		t.Fatalf("size = %dx%d, want 200x150", v.Width, v.Height)
	}
	if v.ContentType != "image/png" {
		t.Fatalf("content_type = %q, want image/png", v.ContentType)
	}
	if v.Extension != ".png" {
		t.Fatalf("extension = %q, want .png", v.Extension)
	}
}

func TestBuildVariants_LargeJPEG_GeneratesDerivatives(t *testing.T) {
	// 1600 px wide yields four variants: 480, 960, 1440, and 1600.
	raw := makeJPEG(t, 1600, 900)
	variants, err := imageproc.BuildVariants(raw, "image/jpeg")
	if err != nil {
		t.Fatalf("BuildVariants: %v", err)
	}
	if len(variants) != 4 {
		t.Fatalf("got %d variants, want 4", len(variants))
	}

	// The source is 16:9, so each height is round(900 * width / 1600).
	wantVariants := []struct{ width, height int }{
		{480, 270},
		{960, 540},
		{1440, 810},
		{1600, 900},
	}
	for i, v := range variants {
		if v.Width != wantVariants[i].width {
			t.Errorf("variants[%d].Width = %d, want %d", i, v.Width, wantVariants[i].width)
		}
		if v.Height != wantVariants[i].height {
			t.Errorf("variants[%d].Height = %d, want %d", i, v.Height, wantVariants[i].height)
		}
		if v.ContentType != "image/jpeg" {
			t.Errorf("variants[%d].ContentType = %q, want image/jpeg", i, v.ContentType)
		}
		if len(v.Data) == 0 {
			t.Errorf("variants[%d].Data is empty", i)
		}
	}
}

func TestBuildVariants_ExactlyAtTarget_NoSmallerVariant(t *testing.T) {
	// Exactly 480 px wide: equal to a target width, so nothing below 480 is
	// generated.
	raw := makeJPEG(t, 480, 360)
	variants, err := imageproc.BuildVariants(raw, "image/jpeg")
	if err != nil {
		t.Fatalf("BuildVariants: %v", err)
	}
	if len(variants) != 1 {
		t.Fatalf("got %d variants, want 1 (original only)", len(variants))
	}
	if variants[0].Width != 480 {
		t.Fatalf("Width = %d, want 480", variants[0].Width)
	}
}

func TestBuildVariants_PNG_KeepsLossless(t *testing.T) {
	// PNG stays PNG, keeping it lossless.
	raw := makePNG(t, 1000, 800)
	variants, err := imageproc.BuildVariants(raw, "image/png")
	if err != nil {
		t.Fatalf("BuildVariants: %v", err)
	}
	for _, v := range variants {
		if v.ContentType != "image/png" {
			t.Errorf("variant w%d: ContentType = %q, want image/png", v.Width, v.ContentType)
		}
		if v.Extension != ".png" {
			t.Errorf("variant w%d: Extension = %q, want .png", v.Width, v.Extension)
		}
	}
}

func TestBuildVariants_EmptyData_Error(t *testing.T) {
	_, err := imageproc.BuildVariants(nil, "image/jpeg")
	if err == nil {
		t.Fatal("want error for empty data, got nil")
	}
}

func TestBuildVariants_CorruptData_Error(t *testing.T) {
	corrupt := []byte{0xff, 0xd8, 0xff, 0x00, 0xde, 0xad, 0xbe, 0xef}
	_, err := imageproc.BuildVariants(corrupt, "image/jpeg")
	if err == nil {
		t.Fatal("want error for corrupt image, got nil")
	}
}

func TestBuildVariants_OversizedFile_Error(t *testing.T) {
	oversized := make([]byte, imageproc.MaxUploadBytes+1)
	_, err := imageproc.BuildVariants(oversized, "image/jpeg")
	if err == nil {
		t.Fatal("want error for oversized file, got nil")
	}
}

func TestBuildVariants_WrongContentType_Error(t *testing.T) {
	raw := makePNG(t, 10, 10)
	_, err := imageproc.BuildVariants(raw, "text/plain")
	if err == nil {
		t.Fatal("want error for non-image content_type, got nil")
	}
}

func TestBuildVariants_ContentTypeAutoDetect(t *testing.T) {
	// An empty content_type is detected from the bytes.
	raw := makePNG(t, 10, 10)
	variants, err := imageproc.BuildVariants(raw, "")
	if err != nil {
		t.Fatalf("BuildVariants with empty content_type: %v", err)
	}
	if len(variants) == 0 {
		t.Fatal("expected at least one variant")
	}
}

func TestBuildEyeCatchVariants_GeneratesExpectedVariants(t *testing.T) {
	raw := makeJPEG(t, 2400, 3200)
	variants, err := imageproc.BuildEyeCatchVariants(raw, "image/jpeg")
	if err != nil {
		t.Fatalf("BuildEyeCatchVariants: %v", err)
	}
	if len(variants) != 12 {
		t.Fatalf("got %d variants, want 12", len(variants))
	}

	hasPortrait1200 := false
	hasSquare1200 := false
	hasLandscape1600 := false
	hasOG1200 := false
	for _, variant := range variants {
		switch variant.Label {
		case "portrait_1200w":
			hasPortrait1200 = variant.Width == 1200 && variant.Height == 1600
		case "square_1200w":
			hasSquare1200 = variant.Width == 1200 && variant.Height == 1200
		case "landscape_1600w":
			hasLandscape1600 = variant.Width == 1600 && variant.Height == 900
		case "og_1200w":
			hasOG1200 = variant.Width == 1200 && variant.Height == 630
		}
	}
	if !hasPortrait1200 || !hasSquare1200 || !hasLandscape1600 || !hasOG1200 {
		t.Fatalf(
			"missing expected variants: portrait=%v square=%v landscape=%v og=%v",
			hasPortrait1200,
			hasSquare1200,
			hasLandscape1600,
			hasOG1200,
		)
	}
}

func TestBuildEyeCatchVariants_RejectsTooSmallImage(t *testing.T) {
	raw := makeJPEG(t, 1200, 1600)
	_, err := imageproc.BuildEyeCatchVariants(raw, "image/jpeg")
	if err == nil {
		t.Fatal("want error for too small image, got nil")
	}
}

// --- TestBuildEyeCatchAspectVariants ---

func TestBuildEyeCatchAspectVariants_GeneratesOneRatioOnly(t *testing.T) {
	raw := makeJPEG(t, 3200, 1800)
	variants, err := imageproc.BuildEyeCatchAspectVariants(raw, "image/jpeg", "landscape")
	if err != nil {
		t.Fatalf("BuildEyeCatchAspectVariants: %v", err)
	}
	if len(variants) != 3 {
		t.Fatalf("got %d variants, want 3", len(variants))
	}
	want := map[string][2]int{
		"landscape_800w":  {800, 450},
		"landscape_1200w": {1200, 675},
		"landscape_1600w": {1600, 900},
	}
	for _, variant := range variants {
		if variant.VariantType != "landscape" {
			t.Fatalf("variant %q has variant_type %q, want landscape", variant.Label, variant.VariantType)
		}
		size, ok := want[variant.Label]
		if !ok {
			t.Fatalf("unexpected variant %q", variant.Label)
		}
		if variant.Width != size[0] || variant.Height != size[1] {
			t.Fatalf("variant %q is %dx%d, want %dx%d", variant.Label, variant.Width, variant.Height, size[0], size[1])
		}
		delete(want, variant.Label)
	}
	if len(want) != 0 {
		t.Fatalf("missing variants: %v", want)
	}
}

func TestBuildEyeCatchAspectVariants_CropsSourceToTheRequestedRatio(t *testing.T) {
	// A 1:1 source asked for as og (1200:630) has to come back at that ratio,
	// or delivery would hand the OG slot a square image.
	raw := makeJPEG(t, 2000, 2000)
	variants, err := imageproc.BuildEyeCatchAspectVariants(raw, "image/jpeg", "og")
	if err != nil {
		t.Fatalf("BuildEyeCatchAspectVariants: %v", err)
	}
	for _, variant := range variants {
		wantHeight := int(math.Round(float64(variant.Width) * 630 / 1200))
		if variant.Height != wantHeight {
			t.Fatalf("variant %q is %dx%d, want %dx%d", variant.Label, variant.Width, variant.Height, variant.Width, wantHeight)
		}
	}
}

func TestBuildEyeCatchAspectVariants_RejectsSourceBelowTheRatioMinimum(t *testing.T) {
	// Tall enough for portrait, one pixel short of the width its largest
	// delivered size needs.
	raw := makeJPEG(t, 1199, 3200)
	_, err := imageproc.BuildEyeCatchAspectVariants(raw, "image/jpeg", "portrait")
	if err == nil {
		t.Fatal("want error for a source below the portrait minimum, got nil")
	}
}

func TestBuildEyeCatchAspectVariants_AcceptsSourceBelowTheWholeEyeCatchMinimum(t *testing.T) {
	// Filling a whole eye-catch needs 2400x3200 because all four ratios come
	// out of that one image. A portrait upload only has to cover the portrait
	// sizes.
	raw := makeJPEG(t, 1200, 1600)
	variants, err := imageproc.BuildEyeCatchAspectVariants(raw, "image/jpeg", "portrait")
	if err != nil {
		t.Fatalf("BuildEyeCatchAspectVariants: %v", err)
	}
	if len(variants) != 3 {
		t.Fatalf("got %d variants, want 3", len(variants))
	}
}

func TestBuildEyeCatchAspectVariants_RejectsUnknownRatio(t *testing.T) {
	raw := makeJPEG(t, 2400, 3200)
	_, err := imageproc.BuildEyeCatchAspectVariants(raw, "image/jpeg", "banner")
	if err == nil {
		t.Fatal("want error for an unknown ratio, got nil")
	}
}

func TestEyeCatchAspects_CoverEveryDeliveredRatio(t *testing.T) {
	aspects := imageproc.EyeCatchAspects()
	byType := make(map[string]imageproc.EyeCatchAspect, len(aspects))
	for _, aspect := range aspects {
		byType[aspect.VariantType] = aspect
	}
	want := map[string][2]int{
		"portrait":  {1200, 1600},
		"square":    {1200, 1200},
		"landscape": {1600, 900},
		"og":        {1200, 630},
	}
	if len(byType) != len(want) {
		t.Fatalf("got %d aspects, want %d", len(byType), len(want))
	}
	for variantType, minimum := range want {
		aspect, ok := byType[variantType]
		if !ok {
			t.Fatalf("aspect %q is missing", variantType)
		}
		if aspect.MinWidth != minimum[0] || aspect.MinHeight != minimum[1] {
			t.Fatalf("aspect %q minimum is %dx%d, want %dx%d", variantType, aspect.MinWidth, aspect.MinHeight, minimum[0], minimum[1])
		}
	}
	if _, ok := imageproc.LookupEyeCatchAspect("banner"); ok {
		t.Fatal("LookupEyeCatchAspect resolved an unknown ratio")
	}
}

// --- TestBuildIcon ---

func TestBuildIcon_CropsNonSquareSourceToSquarePNG(t *testing.T) {
	raw := makeJPEG(t, 400, 200)
	variant, err := imageproc.BuildIcon(raw, "image/jpeg")
	if err != nil {
		t.Fatalf("BuildIcon: %v", err)
	}
	if variant.Width != 200 || variant.Height != 200 {
		t.Fatalf("size = %dx%d, want 200x200", variant.Width, variant.Height)
	}
	if variant.ContentType != "image/png" {
		t.Fatalf("content_type = %q, want image/png", variant.ContentType)
	}
	if variant.Extension != ".png" {
		t.Fatalf("extension = %q, want .png", variant.Extension)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(variant.Data))
	if err != nil {
		t.Fatalf("DecodeConfig: %v", err)
	}
	if cfg.Width != 200 || cfg.Height != 200 {
		t.Fatalf("encoded size = %dx%d, want 200x200", cfg.Width, cfg.Height)
	}
}

func TestBuildIcon_ScalesOversizedSourceDown(t *testing.T) {
	raw := makePNG(t, 2000, 2000)
	variant, err := imageproc.BuildIcon(raw, "image/png")
	if err != nil {
		t.Fatalf("BuildIcon: %v", err)
	}
	if variant.Width != imageproc.IconMaxDimension || variant.Height != imageproc.IconMaxDimension {
		t.Fatalf("size = %dx%d, want %dx%d", variant.Width, variant.Height, imageproc.IconMaxDimension, imageproc.IconMaxDimension)
	}
}

func TestBuildIcon_RejectsTooSmallImage(t *testing.T) {
	raw := makePNG(t, 16, 16)
	if _, err := imageproc.BuildIcon(raw, "image/png"); err == nil {
		t.Fatal("want error for an image below the minimum dimension")
	}
}

func TestBuildIcon_RejectsNonImageContentType(t *testing.T) {
	raw := makePNG(t, 64, 64)
	if _, err := imageproc.BuildIcon(raw, "application/pdf"); err == nil {
		t.Fatal("want error for a non-image content type")
	}
}

func TestBuildIcon_RejectsEmptyData(t *testing.T) {
	if _, err := imageproc.BuildIcon(nil, "image/png"); err == nil {
		t.Fatal("want error for empty data")
	}
}

// pngHeaderWithDeclaredSize builds a PNG holding nothing but an IHDR chunk.
// image.DecodeConfig reads only that chunk, so this reproduces an upload that
// declares huge dimensions while carrying no actual image data.
func pngHeaderWithDeclaredSize(width, height uint32) []byte {
	var ihdr bytes.Buffer
	ihdr.WriteString("IHDR")
	_ = binary.Write(&ihdr, binary.BigEndian, width)
	_ = binary.Write(&ihdr, binary.BigEndian, height)
	ihdr.Write([]byte{8, 6, 0, 0, 0}) // bit depth, color type, compression, filter, interlace

	var buf bytes.Buffer
	buf.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	_ = binary.Write(&buf, binary.BigEndian, uint32(13))
	buf.Write(ihdr.Bytes())
	_ = binary.Write(&buf, binary.BigEndian, crc32.ChecksumIEEE(ihdr.Bytes()))
	return buf.Bytes()
}

func TestBuildIcon_RejectsOversizedPixelCountBeforeDecoding(t *testing.T) {
	// A few dozen bytes on upload that decode to 1.6 billion pixels.
	raw := pngHeaderWithDeclaredSize(40_000, 40_000)

	if _, err := imageproc.BuildIcon(raw, "image/png"); err == nil {
		t.Fatal("want error for an image whose declared pixel count exceeds the limit")
	}
}

// --- TestBuildLogo ---

func TestBuildLogo_KeepsAspectRatioAndEncodesPNG(t *testing.T) {
	raw := makeJPEG(t, 400, 200)
	variant, err := imageproc.BuildLogo(raw, "image/jpeg")
	if err != nil {
		t.Fatalf("BuildLogo: %v", err)
	}
	if variant.Width != 400 || variant.Height != 200 {
		t.Fatalf("size = %dx%d, want 400x200", variant.Width, variant.Height)
	}
	if variant.ContentType != "image/png" {
		t.Fatalf("content_type = %q, want image/png", variant.ContentType)
	}
	if variant.Extension != ".png" {
		t.Fatalf("extension = %q, want .png", variant.Extension)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(variant.Data))
	if err != nil {
		t.Fatalf("DecodeConfig: %v", err)
	}
	if cfg.Width != 400 || cfg.Height != 200 {
		t.Fatalf("encoded size = %dx%d, want 400x200", cfg.Width, cfg.Height)
	}
}

func TestBuildLogo_ScalesLongestEdgeDownKeepingAspectRatio(t *testing.T) {
	raw := makePNG(t, 4000, 1000)
	variant, err := imageproc.BuildLogo(raw, "image/png")
	if err != nil {
		t.Fatalf("BuildLogo: %v", err)
	}
	if variant.Width != imageproc.LogoMaxDimension {
		t.Fatalf("width = %d, want %d", variant.Width, imageproc.LogoMaxDimension)
	}
	if variant.Height != imageproc.LogoMaxDimension/4 {
		t.Fatalf("height = %d, want %d", variant.Height, imageproc.LogoMaxDimension/4)
	}
}

func TestBuildLogo_ScalesTallSourceByItsHeight(t *testing.T) {
	raw := makePNG(t, 1000, 4000)
	variant, err := imageproc.BuildLogo(raw, "image/png")
	if err != nil {
		t.Fatalf("BuildLogo: %v", err)
	}
	if variant.Height != imageproc.LogoMaxDimension {
		t.Fatalf("height = %d, want %d", variant.Height, imageproc.LogoMaxDimension)
	}
	if variant.Width != imageproc.LogoMaxDimension/4 {
		t.Fatalf("width = %d, want %d", variant.Width, imageproc.LogoMaxDimension/4)
	}
}

func TestBuildLogo_RejectsShortEdgeBelowMinimum(t *testing.T) {
	raw := makePNG(t, 400, 16)
	if _, err := imageproc.BuildLogo(raw, "image/png"); err == nil {
		t.Fatal("want error for an image whose short edge is below the minimum")
	}
}

func TestBuildLogo_RejectsShortEdgeThatFallsBelowMinimumAfterScaling(t *testing.T) {
	// Both edges clear 32 px on upload, but bringing the longest edge within
	// 1024 px leaves the short edge at 2 px.
	raw := makePNG(t, 20_000, 40)
	if _, err := imageproc.BuildLogo(raw, "image/png"); err == nil {
		t.Fatal("want error for an image whose short edge falls below the minimum after scaling")
	}
}

func TestBuildLogo_RejectsNonImageContentType(t *testing.T) {
	raw := makePNG(t, 400, 200)
	if _, err := imageproc.BuildLogo(raw, "application/pdf"); err == nil {
		t.Fatal("want error for a non-image content type")
	}
}

func TestBuildLogo_RejectsEmptyData(t *testing.T) {
	if _, err := imageproc.BuildLogo(nil, "image/png"); err == nil {
		t.Fatal("want error for empty data")
	}
}

func TestBuildLogo_RejectsOversizedPixelCountBeforeDecoding(t *testing.T) {
	raw := pngHeaderWithDeclaredSize(40_000, 40_000)

	if _, err := imageproc.BuildLogo(raw, "image/png"); err == nil {
		t.Fatal("want error for an image whose declared pixel count exceeds the limit")
	}
}
