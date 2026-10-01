package imageproc

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"

	xdraw "golang.org/x/image/draw"
)

// EpisodePreviewPageCount is how many of an episode's opening pages are
// offered as a preview of a body the reader may not open. Two is the cover and
// the page after it: a viewer that shows the cover alone and pairs the pages
// from there shows one page and then one spread's worth of what follows.
const EpisodePreviewPageCount = 2

// EpisodePreviewMaxEdge bounds the longest edge of a preview, in pixels.
//
// The bound is what makes the preview safe to hand to anyone, and the blur is
// not: a blur over a full-size page is a filter whose inverse sharpening can
// approximate, while a page reduced to this size no longer holds the detail to
// recover. At 64 px a 1200x1800 page becomes 43x64, so its lettering, some
// thirty pixels tall at full size, is about one pixel tall — a texture rather
// than a character.
const EpisodePreviewMaxEdge = 64

// episodePreviewBlurSigma is the Gaussian blur applied after the reduction, in
// preview pixels. It adds no protection of its own; it is there so a client
// that draws the preview larger shows a soft impression of the page rather
// than a mosaic of its downscaled pixels.
const episodePreviewBlurSigma = 1.2

// EpisodePreviewContentType is what every preview is encoded as. A preview
// carries no transparency worth keeping and no detail worth a lossless format.
const EpisodePreviewContentType = "image/jpeg"

// episodePreviewQuality is the JPEG quality a preview is encoded at. The
// image is already blurred, so a lower quality costs nothing visible.
const episodePreviewQuality = 70

// EpisodePreviewSize returns the dimensions of the preview rendered from a
// page of the given size: the longest edge brought within
// EpisodePreviewMaxEdge with the aspect ratio kept, never enlarged, and never
// below a pixel on either edge.
func EpisodePreviewSize(sourceWidth, sourceHeight int) (width, height int) {
	if sourceWidth <= 0 || sourceHeight <= 0 {
		return 1, 1
	}
	return fitWithinLongestEdge(sourceWidth, sourceHeight, EpisodePreviewMaxEdge)
}

// BuildEpisodePreview renders the preview of one episode page from a stored
// rendition of it: reduced to EpisodePreviewSize, blurred, flattened onto
// white, and encoded as EpisodePreviewContentType.
//
// The input is a stored page rather than an upload, but the same caps apply
// before decoding: the declared dimensions are checked first, so an object
// that claims a huge canvas is refused rather than decoded.
func BuildEpisodePreview(raw []byte) (Variant, error) {
	if len(raw) == 0 {
		return Variant{}, errors.New("image data is required")
	}
	if len(raw) > MaxUploadBytes {
		return Variant{}, fmt.Errorf("image size exceeds %d bytes", MaxUploadBytes)
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return Variant{}, errors.New("image is not decodable")
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return Variant{}, errors.New("image has invalid dimensions")
	}
	if int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return Variant{}, fmt.Errorf("image dimensions exceed %d pixels", MaxPixels)
	}

	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return Variant{}, errors.New("image is not decodable")
	}

	width, height := EpisodePreviewSize(cfg.Width, cfg.Height)
	// A transparent page would otherwise encode as black, since JPEG has no
	// alpha: the page is laid on the white it is printed on.
	reduced := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(reduced, reduced.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	xdraw.CatmullRom.Scale(reduced, reduced.Bounds(), src, src.Bounds(), xdraw.Over, nil)

	blurred := gaussianBlur(reduced, episodePreviewBlurSigma)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, blurred, &jpeg.Options{Quality: episodePreviewQuality}); err != nil {
		return Variant{}, fmt.Errorf("encode preview: %w", err)
	}
	return Variant{
		Label:       "preview",
		ContentType: EpisodePreviewContentType,
		Extension:   ".jpg",
		Width:       width,
		Height:      height,
		Data:        buf.Bytes(),
	}, nil
}

// gaussianBlur blurs an opaque image with a separable Gaussian kernel of the
// given sigma, clamping at the edges so the border does not darken.
func gaussianBlur(src *image.RGBA, sigma float64) *image.RGBA {
	kernel := gaussianKernel(sigma)
	radius := len(kernel) / 2
	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()

	horizontal := image.NewRGBA(bounds)
	for y := range height {
		for x := range width {
			var acc [4]float64
			for k, weight := range kernel {
				sx := min(max(x+k-radius, 0), width-1)
				offset := src.PixOffset(bounds.Min.X+sx, bounds.Min.Y+y)
				for c := range acc {
					acc[c] += weight * float64(src.Pix[offset+c])
				}
			}
			writePixel(horizontal, bounds.Min.X+x, bounds.Min.Y+y, acc)
		}
	}

	out := image.NewRGBA(bounds)
	for y := range height {
		for x := range width {
			var acc [4]float64
			for k, weight := range kernel {
				sy := min(max(y+k-radius, 0), height-1)
				offset := horizontal.PixOffset(bounds.Min.X+x, bounds.Min.Y+sy)
				for c := range acc {
					acc[c] += weight * float64(horizontal.Pix[offset+c])
				}
			}
			writePixel(out, bounds.Min.X+x, bounds.Min.Y+y, acc)
		}
	}
	return out
}

// gaussianKernel returns the normalized one-dimensional kernel for sigma,
// three sigmas wide on either side of the centre.
func gaussianKernel(sigma float64) []float64 {
	radius := int(math.Ceil(sigma * 3))
	kernel := make([]float64, 2*radius+1)
	var sum float64
	for i := range kernel {
		d := float64(i - radius)
		kernel[i] = math.Exp(-(d * d) / (2 * sigma * sigma))
		sum += kernel[i]
	}
	for i := range kernel {
		kernel[i] /= sum
	}
	return kernel
}

func writePixel(dst *image.RGBA, x, y int, acc [4]float64) {
	offset := dst.PixOffset(x, y)
	for c, value := range acc {
		dst.Pix[offset+c] = uint8(min(max(math.Round(value), 0), 255))
	}
}
