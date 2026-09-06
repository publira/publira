package imageproc

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/jpeg"
	"image/png"
	_ "image/png"
	"math"
	"net/http"
	"slices"
	"strings"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	// MaxUploadBytes is the largest upload accepted, 20 MiB.
	MaxUploadBytes = 20 << 20
	// MaxPixels is the largest pixel count accepted in an upload.
	MaxPixels = 40_000_000
)

// variantTargetWidths lists the widths, in pixels, the derived images are
// generated at. A target width is skipped when the upload is no wider than it,
// so a variant is never enlarged beyond its source.
var variantTargetWidths = []int{480, 960, 1440}

// Variant holds one derived image.
type Variant struct {
	// VariantType names the intended use: portrait / square / landscape / og.
	VariantType string
	// Label states the width, as in "w480". Object keys are built from it.
	Label string
	// ContentType is the MIME type, such as "image/jpeg" or "image/png".
	ContentType string
	// Extension is the file extension, such as ".jpg" or ".png".
	Extension string
	// Width and Height are the image size in pixels.
	Width  int
	Height int
	// Data is the encoded image.
	Data []byte
}

// BuildVariants derives images at several sizes from raw.
//
// A source wider than 480, 960, or 1440 px is resized down to each of those
// widths, and the returned set also includes the source size itself. It
// returns an error when:
//   - the data is empty or exceeds the size cap
//   - content_type is not image/*
//   - the image is undecodable, has non-positive dimensions, or exceeds the
//     pixel cap
func BuildVariants(raw []byte, contentType string) ([]Variant, error) {
	if len(raw) == 0 {
		return nil, errors.New("image data is required")
	}
	if len(raw) > MaxUploadBytes {
		return nil, fmt.Errorf("image size exceeds %d bytes", MaxUploadBytes)
	}

	ct := strings.TrimSpace(contentType)
	if ct == "" {
		ct = http.DetectContentType(raw)
	}
	if !strings.HasPrefix(ct, "image/") {
		return nil, errors.New("content_type must be image/*")
	}

	cfg, sourceFormat, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("image is not decodable")
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, errors.New("image has invalid dimensions")
	}
	if int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return nil, fmt.Errorf("image dimensions exceed %d pixels", MaxPixels)
	}

	outContentType, outExt := outputFormat(sourceFormat)
	widths := selectWidths(cfg.Width)

	needsDecode := outContentType != sourceFormatContentType(sourceFormat)
	if !needsDecode {
		for _, w := range widths {
			if w != cfg.Width {
				needsDecode = true
				break
			}
		}
	}

	var srcImg image.Image
	if needsDecode {
		decoded, _, decodeErr := image.Decode(bytes.NewReader(raw))
		if decodeErr != nil {
			return nil, errors.New("image is not decodable")
		}
		srcImg = decoded
	}

	variants := make([]Variant, 0, len(widths))
	for _, width := range widths {
		height := scaledHeight(cfg.Width, cfg.Height, width)

		if width == cfg.Width && outContentType == sourceFormatContentType(sourceFormat) {
			variants = append(variants, Variant{
				Label:       fmt.Sprintf("w%d", width),
				ContentType: outContentType,
				Extension:   outExt,
				Width:       width,
				Height:      height,
				Data:        raw,
			})
			continue
		}

		encoded, encodeErr := encode(srcImg, width, height, outContentType)
		if encodeErr != nil {
			return nil, fmt.Errorf("encode variant w%d: %w", width, encodeErr)
		}
		variants = append(variants, Variant{
			Label:       fmt.Sprintf("w%d", width),
			ContentType: outContentType,
			Extension:   outExt,
			Width:       width,
			Height:      height,
			Data:        encoded,
		})
	}

	return variants, nil
}

// outputFormat picks the output MIME type and file extension from the source
// format. PNG and GIF stay lossless as PNG; everything else becomes JPEG.
func outputFormat(sourceFormat string) (contentType, extension string) {
	switch strings.ToLower(strings.TrimSpace(sourceFormat)) {
	case "png", "gif":
		return "image/png", ".png"
	default:
		return "image/jpeg", ".jpg"
	}
}

// sourceFormatContentType turns the format name image.DecodeConfig reports
// into a MIME type.
func sourceFormatContentType(sourceFormat string) string {
	switch strings.ToLower(strings.TrimSpace(sourceFormat)) {
	case "png":
		return "image/png"
	case "jpeg", "jpg":
		return "image/jpeg"
	case "gif":
		return "image/gif"
	default:
		return ""
	}
}

// selectWidths returns the widths to derive for a source of sourceWidth: the
// target widths below it, followed by sourceWidth itself.
func selectWidths(sourceWidth int) []int {
	if sourceWidth <= 0 {
		return []int{1}
	}
	selected := make([]int, 0, len(variantTargetWidths)+1)
	seen := make(map[int]struct{}, len(variantTargetWidths)+1)
	for _, w := range variantTargetWidths {
		if sourceWidth > w {
			if _, ok := seen[w]; !ok {
				selected = append(selected, w)
				seen[w] = struct{}{}
			}
		}
	}
	if _, ok := seen[sourceWidth]; !ok {
		selected = append(selected, sourceWidth)
	}
	return selected
}

// scaledHeight computes the height that keeps the aspect ratio at targetWidth.
func scaledHeight(sourceWidth, sourceHeight, targetWidth int) int {
	if sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 {
		return 1
	}
	h := int(math.Round(float64(sourceHeight) * float64(targetWidth) / float64(sourceWidth)))
	if h < 1 {
		return 1
	}
	return h
}

// encode resizes src to width x height and encodes it in the given format,
// downscaling through the Catmull-Rom kernel for quality.
func encode(src image.Image, width, height int, contentType string) ([]byte, error) {
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Over, nil)

	var buf bytes.Buffer
	switch contentType {
	case "image/png":
		if err := png.Encode(&buf, dst); err != nil {
			return nil, err
		}
	default:
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 82}); err != nil {
			return nil, err
		}
	}
	return buf.Bytes(), nil
}

// EyeCatchMinWidth and EyeCatchMinHeight are the smallest upload accepted for
// a whole eye-catch, stated against the 3:4 ratio.
const (
	EyeCatchMinWidth  = 2400
	EyeCatchMinHeight = 3200
	EyeCatchMaxBytes  = 10 << 20
)

// eyeCatchAspectSpec describes the sizes derived for one eye-catch ratio.
type eyeCatchAspectSpec struct {
	ratio      string // "portrait" / "square" / "landscape" / "og"
	aspectW    int    // aspect width
	aspectH    int    // aspect height
	widthSteps []int  // widths to generate, in pixels
}

// eyeCatchAspectSpecs is the set of ratios and widths an eye-catch is
// delivered in.
var eyeCatchAspectSpecs = []eyeCatchAspectSpec{
	{"portrait", 3, 4, []int{600, 900, 1200}},
	{"square", 1, 1, []int{600, 900, 1200}},
	{"landscape", 16, 9, []int{800, 1200, 1600}},
	{"og", 1200, 630, []int{600, 900, 1200}},
}

// EyeCatchAspect is one aspect ratio an eye-catch is delivered in, together
// with the smallest image that can be uploaded for it. Callers outside this
// package use it to enumerate the ratios and to tell an editor what a given
// slot expects.
type EyeCatchAspect struct {
	// VariantType names the ratio: portrait / square / landscape / og.
	VariantType string
	// AspectWidth / AspectHeight are the ratio itself, not pixel sizes.
	AspectWidth  int
	AspectHeight int
	// MinWidth / MinHeight are the smallest source accepted for this ratio.
	// They equal the largest size generated for it, so every delivered width
	// comes from downscaling rather than from enlarging.
	MinWidth  int
	MinHeight int
}

func (s eyeCatchAspectSpec) aspect() EyeCatchAspect {
	minWidth := slices.Max(s.widthSteps)
	return EyeCatchAspect{
		VariantType:  s.ratio,
		AspectWidth:  s.aspectW,
		AspectHeight: s.aspectH,
		MinWidth:     minWidth,
		MinHeight:    scaledHeight(s.aspectW, s.aspectH, minWidth),
	}
}

// EyeCatchAspects returns every aspect ratio an eye-catch is delivered in, in
// the order the console shows them.
func EyeCatchAspects() []EyeCatchAspect {
	aspects := make([]EyeCatchAspect, 0, len(eyeCatchAspectSpecs))
	for _, spec := range eyeCatchAspectSpecs {
		aspects = append(aspects, spec.aspect())
	}
	return aspects
}

// LookupEyeCatchAspect returns the aspect ratio named by variantType.
func LookupEyeCatchAspect(variantType string) (EyeCatchAspect, bool) {
	for _, spec := range eyeCatchAspectSpecs {
		if spec.ratio == variantType {
			return spec.aspect(), true
		}
	}
	return EyeCatchAspect{}, false
}

// CropRect names the part of an uploaded image to keep, in pixels of that
// upload with the origin at its top-left corner. It says where the cut is
// taken and not what shape comes out: the region is still fitted to the
// target ratio afterwards, the way a whole image is.
type CropRect struct {
	X      int
	Y      int
	Width  int
	Height int
}

// ErrInvalidCrop marks a failure the crop rectangle caused rather than the
// upload itself: a rectangle outside the image, or one too small to cover the
// ratio's delivered sizes once it is fitted. A caller reporting a field
// violation names the rectangle's field for it, so an editor is pointed at
// the selection it made instead of at an image that is perfectly usable.
var ErrInvalidCrop = errors.New("invalid crop rectangle")

// BuildEyeCatchAspectVariants builds the delivery sizes of a single aspect
// ratio from an image uploaded for that ratio alone.
//
// Unlike BuildEyeCatchVariants, which fills a whole eye-catch by cropping all
// four ratios out of one image, this validates and crops against the named
// ratio only. A nil crop takes the cut from the centre of the upload; a crop
// takes it from the named rectangle instead. Either way the region is fitted
// to the ratio: an upload, or a selection, that is a few pixels off the ratio
// must not change the shape delivery relies on.
//
// Input validation:
//   - within EyeCatchMaxBytes, image/* content_type
//   - variantType names one of the delivered ratios
//   - crop, when given, lies within the upload
//   - at least the ratio's MinWidth x MinHeight after cropping
func BuildEyeCatchAspectVariants(raw []byte, contentType string, variantType string, crop *CropRect) ([]Variant, error) {
	spec, ok := lookupEyeCatchAspectSpec(variantType)
	if !ok {
		return nil, fmt.Errorf("unknown eye_catch aspect ratio %q", variantType)
	}
	if len(raw) == 0 {
		return nil, errors.New("image data is required")
	}
	if len(raw) > EyeCatchMaxBytes {
		return nil, fmt.Errorf("image size exceeds %d bytes", EyeCatchMaxBytes)
	}

	ct := strings.TrimSpace(contentType)
	if ct == "" {
		ct = http.DetectContentType(raw)
	}
	if !strings.HasPrefix(ct, "image/") {
		return nil, errors.New("content_type must be image/*")
	}

	// The declared dimensions are checked before decoding: the byte cap alone
	// leaves a small PNG or WebP free to claim a huge canvas and exhaust
	// memory while it is being decoded.
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("image is not decodable")
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, errors.New("image has invalid dimensions")
	}
	if int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return nil, fmt.Errorf("image dimensions exceed %d pixels", MaxPixels)
	}

	src, srcFormat, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("image is not decodable")
	}

	region := src
	if crop != nil {
		region, err = cropRegion(src, *crop)
		if err != nil {
			return nil, err
		}
	}

	aspect := spec.aspect()
	cropped := centerCropToAspect(region, spec.aspectW, spec.aspectH)
	cropBounds := cropped.Bounds()
	cropW := cropBounds.Dx()
	cropH := cropBounds.Dy()
	if cropW < aspect.MinWidth || cropH < aspect.MinHeight {
		if crop != nil {
			return nil, fmt.Errorf("%w: %s crop must be at least %dx%d after fitting to %d:%d", ErrInvalidCrop, spec.ratio, aspect.MinWidth, aspect.MinHeight, spec.aspectW, spec.aspectH)
		}
		return nil, fmt.Errorf("%s image must be at least %dx%d after cropping to %d:%d", spec.ratio, aspect.MinWidth, aspect.MinHeight, spec.aspectW, spec.aspectH)
	}

	outContentType, outExt := outputFormat(srcFormat)

	variants := make([]Variant, 0, len(spec.widthSteps))
	for _, targetW := range spec.widthSteps {
		w := targetW
		if w > cropW {
			w = cropW
		}
		h := scaledHeight(cropW, cropH, w)
		label := fmt.Sprintf("%s_%dw", spec.ratio, w)

		encoded, encErr := encode(cropped, w, h, outContentType)
		if encErr != nil {
			return nil, fmt.Errorf("encode %s: %w", label, encErr)
		}
		variants = append(variants, Variant{
			VariantType: spec.ratio,
			Label:       label,
			ContentType: outContentType,
			Extension:   outExt,
			Width:       w,
			Height:      h,
			Data:        encoded,
		})
	}
	return variants, nil
}

func lookupEyeCatchAspectSpec(variantType string) (eyeCatchAspectSpec, bool) {
	for _, spec := range eyeCatchAspectSpecs {
		if spec.ratio == variantType {
			return spec, true
		}
	}
	return eyeCatchAspectSpec{}, false
}

// centerCropToAspect centre-crops src to the given aspect ratio.
func centerCropToAspect(src image.Image, aspectW, aspectH int) image.Image {
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()

	targetRatio := float64(aspectW) / float64(aspectH)
	srcRatio := float64(srcW) / float64(srcH)

	var cropW, cropH int
	if srcRatio > targetRatio {
		cropH = srcH
		cropW = int(math.Round(float64(srcH) * targetRatio))
	} else {
		cropW = srcW
		cropH = int(math.Round(float64(srcW) / targetRatio))
	}
	if cropW > srcW {
		cropW = srcW
	}
	if cropH > srcH {
		cropH = srcH
	}

	offsetX := (srcW - cropW) / 2
	offsetY := (srcH - cropH) / 2

	return subImage(src, image.Rect(
		bounds.Min.X+offsetX,
		bounds.Min.Y+offsetY,
		bounds.Min.X+offsetX+cropW,
		bounds.Min.Y+offsetY+cropH,
	))
}

// cropRegion cuts rect out of src. rect is stated in pixels of the uploaded
// image, so it is offset by the source bounds rather than taken as it stands:
// src can be a sub-image whose bounds do not start at the origin.
func cropRegion(src image.Image, rect CropRect) (image.Image, error) {
	bounds := src.Bounds()
	if rect.Width <= 0 || rect.Height <= 0 {
		return nil, fmt.Errorf("%w: crop size must be positive, got %dx%d", ErrInvalidCrop, rect.Width, rect.Height)
	}
	if rect.X < 0 || rect.Y < 0 || rect.X+rect.Width > bounds.Dx() || rect.Y+rect.Height > bounds.Dy() {
		return nil, fmt.Errorf("%w: crop %dx%d at (%d,%d) falls outside the %dx%d image", ErrInvalidCrop, rect.Width, rect.Height, rect.X, rect.Y, bounds.Dx(), bounds.Dy())
	}
	return subImage(src, image.Rect(
		bounds.Min.X+rect.X,
		bounds.Min.Y+rect.Y,
		bounds.Min.X+rect.X+rect.Width,
		bounds.Min.Y+rect.Y+rect.Height,
	)), nil
}

// subImage returns the part of src inside rect, sharing its pixels when the
// concrete image type allows it and copying them when it does not.
func subImage(src image.Image, rect image.Rectangle) image.Image {
	type subImager interface {
		SubImage(r image.Rectangle) image.Image
	}
	if si, ok := src.(subImager); ok {
		return si.SubImage(rect)
	}

	dst := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	for y := range rect.Dy() {
		for x := range rect.Dx() {
			dst.Set(x, y, src.At(rect.Min.X+x, rect.Min.Y+y))
		}
	}
	return dst
}

// BuildEyeCatchVariants derives every eye-catch variant from a single upload.
//
// Input validation:
//   - within EyeCatchMaxBytes, image/* content_type
//   - at least 2400x3200 px, the minimum stated against the 3:4 ratio
//
// It returns the portrait, square, landscape, and og ratios, each at several
// widths, labelled "{ratio}_{width}w" (for example "portrait_1200w").
func BuildEyeCatchVariants(raw []byte, contentType string) ([]Variant, error) {
	if len(raw) == 0 {
		return nil, errors.New("image data is required")
	}
	if len(raw) > EyeCatchMaxBytes {
		return nil, fmt.Errorf("image size exceeds %d bytes", EyeCatchMaxBytes)
	}

	ct := strings.TrimSpace(contentType)
	if ct == "" {
		ct = http.DetectContentType(raw)
	}
	if !strings.HasPrefix(ct, "image/") {
		return nil, errors.New("content_type must be image/*")
	}

	src, srcFormat, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("image is not decodable")
	}
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	if srcW < EyeCatchMinWidth || srcH < EyeCatchMinHeight {
		return nil, fmt.Errorf("eye_catch image must be at least %dx%d", EyeCatchMinWidth, EyeCatchMinHeight)
	}

	outContentType, outExt := outputFormat(srcFormat)

	variants := make([]Variant, 0, 12)
	for _, spec := range eyeCatchAspectSpecs {
		cropped := centerCropToAspect(src, spec.aspectW, spec.aspectH)
		cropBounds := cropped.Bounds()
		cropW := cropBounds.Dx()
		cropH := cropBounds.Dy()

		for _, targetW := range spec.widthSteps {
			w := targetW
			if w > cropW {
				w = cropW
			}
			h := scaledHeight(cropW, cropH, w)
			label := fmt.Sprintf("%s_%dw", spec.ratio, w)

			encoded, encErr := encode(cropped, w, h, outContentType)
			if encErr != nil {
				return nil, fmt.Errorf("encode %s: %w", label, encErr)
			}
			variants = append(variants, Variant{
				VariantType: spec.ratio,
				Label:       label,
				ContentType: outContentType,
				Extension:   outExt,
				Width:       w,
				Height:      h,
				Data:        encoded,
			})
		}
	}
	return variants, nil
}

// TenantVariantTypeLogo and TenantVariantTypeIcon name what a tenant branding
// image is for. They sit where a series variant_type does (portrait / square /
// …) and say nothing about size: image-server downscales the stored image to
// the requested size when it is asked for.
const (
	TenantVariantTypeLogo = "logo"
	TenantVariantTypeIcon = "icon"
)

// IconMaxBytes, IconMinDimension, and IconMaxDimension constrain a tenant icon
// upload. The 32 px floor is what a 32x32 rendering needs; the 512 px ceiling
// covers apple-touch-icon, and anything larger is scaled down to it.
const (
	IconMaxBytes     = 10 << 20
	IconMinDimension = 32
	IconMaxDimension = 512
)

// BuildIcon derives the single tenant icon variant from an upload.
//
// Input validation:
//   - within IconMaxBytes, image/* content_type
//   - pixel count within MaxPixels
//   - at least 32 px on a side after centre-cropping
//
// The output is always PNG. An icon is drawn small with its transparency
// intact, and encoding it as JPEG would fill that transparency with a
// background.
func BuildIcon(raw []byte, contentType string) (Variant, error) {
	if len(raw) == 0 {
		return Variant{}, errors.New("image data is required")
	}
	if len(raw) > IconMaxBytes {
		return Variant{}, fmt.Errorf("image size exceeds %d bytes", IconMaxBytes)
	}

	ct := strings.TrimSpace(contentType)
	if ct == "" {
		ct = http.DetectContentType(raw)
	}
	if !strings.HasPrefix(ct, "image/") {
		return Variant{}, errors.New("content_type must be image/*")
	}

	// The declared dimensions are checked before decoding: the byte cap alone
	// leaves a small PNG or WebP free to claim a huge canvas and exhaust
	// memory while it is being decoded.
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

	cropped := centerCropToAspect(src, 1, 1)
	size := cropped.Bounds().Dx()
	if size < IconMinDimension {
		return Variant{}, fmt.Errorf("icon image must be at least %dx%d", IconMinDimension, IconMinDimension)
	}
	if size > IconMaxDimension {
		size = IconMaxDimension
	}

	encoded, err := encode(cropped, size, size, "image/png")
	if err != nil {
		return Variant{}, fmt.Errorf("encode icon: %w", err)
	}

	return Variant{
		VariantType: TenantVariantTypeIcon,
		Label:       "original",
		ContentType: "image/png",
		Extension:   ".png",
		Width:       size,
		Height:      size,
		Data:        encoded,
	}, nil
}

// LogoMaxBytes, LogoMinDimension, and LogoMaxDimension constrain a tenant logo
// upload.
//
// Unlike an icon, a logo keeps its aspect ratio: most logos are wordmarks, and
// cropping one to a square cuts letters off. Only the longest edge is brought
// within LogoMaxDimension.
const (
	LogoMaxBytes     = 10 << 20
	LogoMinDimension = 32
	LogoMaxDimension = 1024
)

// BuildLogo derives the single tenant logo variant from an upload.
//
// Input validation:
//   - within LogoMaxBytes, image/* content_type
//   - pixel count within MaxPixels
//   - at least 32 px on the shortest edge, measured after the longest edge is
//     scaled down as well
//
// The output is always PNG. A logo is placed over headers of differing
// background colors, so encoding it as JPEG would drop its transparency and
// leave a rectangle around it.
func BuildLogo(raw []byte, contentType string) (Variant, error) {
	if len(raw) == 0 {
		return Variant{}, errors.New("image data is required")
	}
	if len(raw) > LogoMaxBytes {
		return Variant{}, fmt.Errorf("image size exceeds %d bytes", LogoMaxBytes)
	}

	ct := strings.TrimSpace(contentType)
	if ct == "" {
		ct = http.DetectContentType(raw)
	}
	if !strings.HasPrefix(ct, "image/") {
		return Variant{}, errors.New("content_type must be image/*")
	}

	// The declared dimensions are checked before decoding: the byte cap alone
	// leaves a small PNG or WebP free to claim a huge canvas and exhaust
	// memory while it is being decoded.
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
	if cfg.Width < LogoMinDimension || cfg.Height < LogoMinDimension {
		return Variant{}, fmt.Errorf("logo image must be at least %dx%d", LogoMinDimension, LogoMinDimension)
	}

	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return Variant{}, errors.New("image is not decodable")
	}

	// The floor on the shortest edge applies after scaling too. Both edges can
	// clear 32 px on upload and still fail here: bringing the longest edge of
	// something like 20000x40 within 1024 px crushes the short edge to a few
	// pixels, storing an image no longer usable as a logo.
	width, height := fitWithinLongestEdge(cfg.Width, cfg.Height, LogoMaxDimension)
	if width < LogoMinDimension || height < LogoMinDimension {
		return Variant{}, fmt.Errorf("logo image aspect ratio is too extreme: %dx%d after scaling is below %dpx", width, height, LogoMinDimension)
	}

	encoded, err := encode(src, width, height, "image/png")
	if err != nil {
		return Variant{}, fmt.Errorf("encode logo: %w", err)
	}

	return Variant{
		VariantType: TenantVariantTypeLogo,
		Label:       "original",
		ContentType: "image/png",
		Extension:   ".png",
		Width:       width,
		Height:      height,
		Data:        encoded,
	}, nil
}

// fitWithinLongestEdge returns the dimensions that bring the longest edge
// within maxEdge while keeping the aspect ratio. A source already within
// maxEdge is returned unchanged; nothing is ever enlarged.
func fitWithinLongestEdge(sourceWidth, sourceHeight, maxEdge int) (width, height int) {
	if sourceWidth <= maxEdge && sourceHeight <= maxEdge {
		return sourceWidth, sourceHeight
	}
	if sourceWidth >= sourceHeight {
		return maxEdge, scaledHeight(sourceWidth, sourceHeight, maxEdge)
	}
	return scaledHeight(sourceHeight, sourceWidth, maxEdge), maxEdge
}
