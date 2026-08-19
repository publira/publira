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
	"strings"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	// MaxUploadBytes は入稿画像の上限サイズ (20 MiB) です。
	MaxUploadBytes = 20 << 20
	// MaxPixels は入稿画像の上限ピクセル数です。
	MaxPixels = 40_000_000
)

// variantTargetWidths は生成する派生画像の幅 (px) のリストです。
// 入稿画像の幅がターゲット幅以下の場合、その派生は生成しません。
var variantTargetWidths = []int{480, 960, 1440}

// Variant は派生画像の情報を保持します。
type Variant struct {
	// VariantType は用途種別です (portrait/square/landscape/og)。
	VariantType string
	// Label は "w480" のように幅を示すラベルです (object key 生成に利用します)。
	Label string
	// ContentType は "image/jpeg" や "image/png" などの MIME タイプです。
	ContentType string
	// Extension は ".jpg" や ".png" などのファイル拡張子です。
	Extension string
	// Width / Height はピクセル単位の画像サイズです。
	Width  int
	Height int
	// Data はエンコード済みの画像バイト列です。
	Data []byte
}

// BuildVariants は raw バイト列から複数サイズの派生画像を生成して返します。
//
// 入稿画像の幅が 480 / 960 / 1440 px を超える場合はそれぞれのサイズにリサイズした
// 派生を生成し、元サイズも含めた全バリアントを返します。
// 以下の場合は error を返します:
//   - データが空 / 上限サイズ超過
//   - content_type が image/* でない
//   - デコード不能 / 寸法が 0 以下 / ピクセル数が上限超過
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

// outputFormat は入稿フォーマットから出力 MIME タイプとファイル拡張子を決定します。
// PNG / GIF はロスレス保持のため PNG に、それ以外は JPEG に変換します。
func outputFormat(sourceFormat string) (contentType, extension string) {
	switch strings.ToLower(strings.TrimSpace(sourceFormat)) {
	case "png", "gif":
		return "image/png", ".png"
	default:
		return "image/jpeg", ".jpg"
	}
}

// sourceFormatContentType は image.DecodeConfig が返すフォーマット名を MIME タイプに変換します。
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

// selectWidths は sourceWidth に応じて生成する派生幅の一覧を返します。
// sourceWidth 未満のターゲット幅のみ含め、末尾に sourceWidth 自体を追加します。
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

// scaledHeight はアスペクト比を保ちながら targetWidth に対する高さを計算します。
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

// encode は src を width×height にリサイズして指定フォーマットでエンコードします。
// Catmull-Rom カーネルを使用して高品質な縮小を行います。
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

// EyeCatchMinWidth / EyeCatchMinHeight は入稿マスター画像の最小サイズです (3:4 基準)。
const (
	EyeCatchMinWidth  = 2400
	EyeCatchMinHeight = 3200
	EyeCatchMaxBytes  = 10 << 20
)

// eyeCatchAspectSpec はアイキャッチ派生サイズ生成の仕様です。
type eyeCatchAspectSpec struct {
	ratio      string // "portrait" / "square" / "landscape" / "og"
	aspectW    int    // アスペクト幅
	aspectH    int    // アスペクト高さ
	widthSteps []int  // 生成する幅 (px)
}

// eyeCatchAspectSpecs はイシュー仕様に基づく派生サイズ定義です。
var eyeCatchAspectSpecs = []eyeCatchAspectSpec{
	{"portrait", 3, 4, []int{600, 900, 1200}},
	{"square", 1, 1, []int{600, 900, 1200}},
	{"landscape", 16, 9, []int{800, 1200, 1600}},
	{"og", 1200, 630, []int{600, 900, 1200}},
}

// centerCropToAspect は src を指定アスペクト比にセンタークロップして返します。
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

	rect := image.Rect(
		bounds.Min.X+offsetX,
		bounds.Min.Y+offsetY,
		bounds.Min.X+offsetX+cropW,
		bounds.Min.Y+offsetY+cropH,
	)

	type subImager interface {
		SubImage(r image.Rectangle) image.Image
	}
	if si, ok := src.(subImager); ok {
		return si.SubImage(rect)
	}

	dst := image.NewRGBA(image.Rect(0, 0, cropW, cropH))
	for y := 0; y < cropH; y++ {
		for x := 0; x < cropW; x++ {
			dst.Set(x, y, src.At(rect.Min.X+x, rect.Min.Y+y))
		}
	}
	return dst
}

// BuildEyeCatchVariants はマスター画像からアイキャッチ用全バリアントを生成します。
//
// 入力バリデーション:
//   - 10MB 以内、image/* content_type
//   - 最小サイズ 2400x3200px (3:4 基準)
//
// 出力: portrait / square / landscape / og の各アスペクト比 × 複数幅のバリアント。
// ラベル形式は "{ratio}_{width}w" (例: "portrait_1200w")。
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

// TenantVariantTypeLogo / TenantVariantTypeIcon はテナントのブランディング
// 画像の用途です。series の variant_type (portrait / square / …) と同じ位置づけで、
// サイズではありません。配信サイズは image-server が保存済みマスターから
// リクエスト時に縮小して作ります。
const (
	TenantVariantTypeLogo = "logo"
	TenantVariantTypeIcon = "icon"
)

// IconMaxBytes / IconMinDimension / IconMaxDimension はテナント
// icon の入稿制約です。最小 32px は 32x32 の描画に耐える下限、最大 512px は
// apple-touch-icon まで賄える上限で、それを超える入稿は縮小します。
const (
	IconMaxBytes     = 10 << 20
	IconMinDimension = 32
	IconMaxDimension = 512
)

// BuildIcon は入稿画像からテナント icon のバリアントを 1 つ生成します。
//
// 入力バリデーション:
//   - 10MB 以内、image/* content_type
//   - ピクセル数が MaxPixels 以内
//   - センタークロップ後の一辺が 32px 以上
//
// 出力は常に PNG です。icon は透過を保ったまま小さなサイズで描画されるため、
// JPEG に落とすと背景が潰れます。
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

	// 展開後のサイズはヘッダから先に検査します。入力バイト数の上限だけでは、
	// 小さな PNG / WebP が巨大な寸法を宣言してデコードでメモリを食い潰す経路を
	// 塞げません。
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

// LogoMaxBytes / LogoMinDimension / LogoMaxDimension はテナント logo の入稿制限です。
//
// icon と違い縦横比は保ちます。logo は多くがワードマークで、正方形に切り出すと
// 文字が欠けるためです。長辺だけを LogoMaxDimension に収めます。
const (
	LogoMaxBytes     = 10 << 20
	LogoMinDimension = 32
	LogoMaxDimension = 1024
)

// BuildLogo は入稿画像からテナント logo のバリアントを 1 つ生成します。
//
// 入力バリデーション:
//   - 10MB 以内、image/* content_type
//   - ピクセル数が MaxPixels 以内
//   - 短辺が 32px 以上 (長辺を縮小したあとの寸法も含む)
//
// 出力は常に PNG です。logo は背景色の異なるヘッダーに重ねて置かれるため、
// JPEG に落とすと透過が失われて周囲に矩形が出ます。
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

	// 展開後のサイズはヘッダから先に検査します。入力バイト数の上限だけでは、
	// 小さな PNG / WebP が巨大な寸法を宣言してデコードでメモリを食い潰す経路を
	// 塞げません。
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

	// 短辺の下限は縮小後にも効かせます。入稿時に両辺が 32px 以上でも、
	// 20000x40 のような極端に細長い入力は長辺を 1024px に収める過程で短辺が
	// 数 px まで潰れ、ロゴとして使えない画像が保存されるためです。
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

// fitWithinLongestEdge は縦横比を保ったまま長辺を maxEdge に収めた寸法を返します。
// 長辺がすでに maxEdge 以下なら入力をそのまま返し、拡大はしません。
func fitWithinLongestEdge(sourceWidth, sourceHeight, maxEdge int) (width, height int) {
	if sourceWidth <= maxEdge && sourceHeight <= maxEdge {
		return sourceWidth, sourceHeight
	}
	if sourceWidth >= sourceHeight {
		return maxEdge, scaledHeight(sourceWidth, sourceHeight, maxEdge)
	}
	return scaledHeight(sourceHeight, sourceWidth, maxEdge), maxEdge
}
