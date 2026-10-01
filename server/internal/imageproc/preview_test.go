package imageproc_test

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"

	"github.com/publira/publira/server/internal/imageproc"
)

func TestEpisodePreviewSize(t *testing.T) {
	cases := []struct {
		name                      string
		sourceWidth, sourceHeight int
		wantWidth, wantHeight     int
	}{
		{name: "a portrait page is bounded by its height", sourceWidth: 1200, sourceHeight: 1800, wantWidth: 43, wantHeight: 64},
		{name: "a landscape spread is bounded by its width", sourceWidth: 2400, sourceHeight: 1800, wantWidth: 64, wantHeight: 48},
		{name: "a page already within the bound is not enlarged", sourceWidth: 30, sourceHeight: 40, wantWidth: 30, wantHeight: 40},
		{name: "an edge never falls below one pixel", sourceWidth: 10000, sourceHeight: 10, wantWidth: 64, wantHeight: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			width, height := imageproc.EpisodePreviewSize(tc.sourceWidth, tc.sourceHeight)
			if width != tc.wantWidth || height != tc.wantHeight {
				t.Fatalf("EpisodePreviewSize(%d, %d) = %dx%d, want %dx%d", tc.sourceWidth, tc.sourceHeight, width, height, tc.wantWidth, tc.wantHeight)
			}
		})
	}
}

func TestBuildEpisodePreview_ReducesThePageToThePreviewSize(t *testing.T) {
	preview, err := imageproc.BuildEpisodePreview(makeJPEG(t, 1200, 1800))
	if err != nil {
		t.Fatalf("BuildEpisodePreview: %v", err)
	}
	if preview.ContentType != imageproc.EpisodePreviewContentType {
		t.Fatalf("content type = %q, want %q", preview.ContentType, imageproc.EpisodePreviewContentType)
	}
	decoded, format, err := image.Decode(bytes.NewReader(preview.Data))
	if err != nil {
		t.Fatalf("decode preview: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("encoded format = %q, want jpeg", format)
	}
	wantWidth, wantHeight := imageproc.EpisodePreviewSize(1200, 1800)
	if got := decoded.Bounds(); got.Dx() != wantWidth || got.Dy() != wantHeight {
		t.Fatalf("decoded size = %dx%d, want %dx%d", got.Dx(), got.Dy(), wantWidth, wantHeight)
	}
	if preview.Width != wantWidth || preview.Height != wantHeight {
		t.Fatalf("reported size = %dx%d, want %dx%d", preview.Width, preview.Height, wantWidth, wantHeight)
	}
}

// Lettering is the finest detail on a page. A pattern of single-pixel lines is
// finer still, so a preview that leaves nothing of it leaves nothing of the
// text either: every pixel comes out as the mid-grey the lines average to.
func TestBuildEpisodePreview_LeavesNoDetailOfFineLines(t *testing.T) {
	const width, height = 1200, 1800
	page := image.NewGray(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			if (x/2+y/2)%2 == 0 {
				page.SetGray(x, y, color.Gray{Y: 255})
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, page); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}

	preview, err := imageproc.BuildEpisodePreview(buf.Bytes())
	if err != nil {
		t.Fatalf("BuildEpisodePreview: %v", err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(preview.Data))
	if err != nil {
		t.Fatalf("decode preview: %v", err)
	}
	lightest, darkest := uint8(0), uint8(255)
	bounds := decoded.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			luma := color.GrayModel.Convert(decoded.At(x, y)).(color.Gray).Y
			lightest = max(lightest, luma)
			darkest = min(darkest, luma)
		}
	}
	if spread := int(lightest) - int(darkest); spread > 24 {
		t.Fatalf("luma spans %d..%d, want the lines flattened into one grey", darkest, lightest)
	}
}

// JPEG has no alpha, so a transparent page has to be laid on white rather
// than coming out black.
func TestBuildEpisodePreview_FlattensTransparencyOntoWhite(t *testing.T) {
	page := image.NewRGBA(image.Rect(0, 0, 600, 900))
	var buf bytes.Buffer
	if err := png.Encode(&buf, page); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}

	preview, err := imageproc.BuildEpisodePreview(buf.Bytes())
	if err != nil {
		t.Fatalf("BuildEpisodePreview: %v", err)
	}
	r, g, b := sampleCenter(t, preview.Data)
	if r < 240 || g < 240 || b < 240 {
		t.Fatalf("centre = (%d, %d, %d), want white", r, g, b)
	}
}

func TestBuildEpisodePreview_RejectsWhatIsNotAPage(t *testing.T) {
	cases := []struct {
		name string
		raw  []byte
	}{
		{name: "nothing", raw: nil},
		{name: "bytes that are no image", raw: []byte("not an image")},
		// A few dozen bytes that would decode to 1.6 billion pixels.
		{name: "a declared canvas over the pixel cap", raw: pngHeaderWithDeclaredSize(40_000, 40_000)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := imageproc.BuildEpisodePreview(tc.raw); err == nil {
				t.Fatal("BuildEpisodePreview succeeded, want an error")
			}
		})
	}
}
