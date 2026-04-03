package imageproc_test

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"github.com/publira/publira/server/internal/imageproc"
)

// --- ヘルパー ---

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
	// 幅 200px は全ターゲット幅 (480/960/1440) 以下なので派生は元サイズのみ
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
	// 幅 1600px → 480 / 960 / 1440 / 1600 の 4 バリアント
	raw := makeJPEG(t, 1600, 900)
	variants, err := imageproc.BuildVariants(raw, "image/jpeg")
	if err != nil {
		t.Fatalf("BuildVariants: %v", err)
	}
	if len(variants) != 4 {
		t.Fatalf("got %d variants, want 4", len(variants))
	}

	// アスペクト比 16:9 のため各幅の高さは round(900 * width / 1600)
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
	// 幅ちょうど 480px → ターゲット幅と等しいので 480 未満のバリアントは生成されない
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
	// PNG → PNG (ロスレス維持)
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
	// content_type が空の場合はバイト列から自動検出
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
