package imageserver

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"manael.org/x/manael/v3"
)

const (
	originPathPrefix        = "/objects/"
	originContentTypeHeader = "X-Publira-Origin-Content-Type"
	imageCacheHeader        = "X-Publira-Image-Cache"
	imageEncryptionHeader   = "X-Publira-Image-Encryption"
	imageContentTypeHeader  = "X-Publira-Image-Content-Type"
	imageKeyIDHeader        = "X-Publira-Image-Key-Id"
	originReadHeaderTimeout = 5 * time.Second
	originShutdownTimeout   = 5 * time.Second
	// defaultMaxConvertedBytes matches Manael's default upstream limit so a
	// converted payload cannot grow past what we are willing to buffer.
	defaultMaxConvertedBytes = 20 << 20
)

var errConvertedTooLarge = errors.New("converted image exceeds size limit")

// Server is the image-server HTTP handler. Close shuts down the loopback
// origin that Manael fetches original objects from.
type Server struct {
	mux    http.Handler
	origin *http.Server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// Close stops the loopback origin used as Manael's upstream.
func (s *Server) Close() error {
	if s == nil || s.origin == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), originShutdownTimeout)
	defer cancel()
	return s.origin.Shutdown(ctx)
}

func startOriginAndProxy(h *Handler) (*http.Server, http.Handler, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, nil, err
	}
	originMux := http.NewServeMux()
	originMux.HandleFunc("GET /objects/{key...}", h.serveOrigin)
	origin := &http.Server{
		Handler:           originMux,
		ReadHeaderTimeout: originReadHeaderTimeout,
	}
	go func() {
		if err := origin.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			h.logger.Error("image origin failed", "error", err)
		}
	}()

	upstream, err := url.Parse("http://" + ln.Addr().String())
	if err != nil {
		_ = origin.Close()
		return nil, nil, err
	}
	proxy := manael.NewServeProxy(
		upstream,
		manael.WithAVIFEnabled(true),
		manael.WithResizeEnabled(true),
	)
	return origin, proxy, nil
}

func (h *Handler) serveOrigin(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if strings.TrimSpace(key) == "" {
		http.NotFound(w, r)
		return
	}
	obj, err := h.objects.GetObject(r.Context(), key)
	if err != nil {
		if errors.Is(err, ErrObjectNotFound) {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}
		h.logger.Error("origin failed to load object", "error", err, "object_key", key)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer obj.Body.Close() //nolint:errcheck

	contentType := strings.TrimSpace(r.Header.Get(originContentTypeHeader))
	if contentType == "" {
		contentType = strings.TrimSpace(obj.ContentType)
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	if obj.ContentLength > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(obj.ContentLength, 10))
	}
	if _, err := io.Copy(w, obj.Body); err != nil {
		h.logger.Error("origin failed to stream object", "error", err, "object_key", key)
	}
}

func (h *Handler) serveConverted(w http.ResponseWriter, r *http.Request, objectKey, fallbackContentType, cacheControl string, cipher *imageCipher) {
	key := cacheKey(objectKey, r)
	if entry, ok := h.cache.Get(r.Context(), key); ok {
		h.writeConvertedImage(w, entry.ContentType, cacheControl, "hit", http.StatusOK, entry.Data, cipher, key)
		return
	}

	limit := h.maxConverted
	if limit <= 0 {
		limit = defaultMaxConvertedBytes
	}
	rec := newLimitedRecorder(limit)
	h.proxy.ServeHTTP(rec, rewriteOriginRequest(r, objectKey, fallbackContentType))
	if rec.overflow {
		h.logger.Error("converted image exceeds size limit", "object_key", objectKey, "limit", limit)
		writeImage(w, "text/plain; charset=utf-8", "", "miss", http.StatusInternalServerError, []byte("internal server error\n"))
		return
	}

	body := rec.buf.Bytes()
	if rec.code == http.StatusOK && len(body) > 0 {
		contentType := strings.TrimSpace(rec.header.Get("Content-Type"))
		if contentType == "" {
			contentType = fallbackContentType
		}
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		h.cache.Set(r.Context(), key, CacheEntry{ContentType: contentType, Data: append([]byte(nil), body...)})
	}

	for name, values := range rec.header {
		if strings.EqualFold(name, "Content-Length") {
			continue
		}
		for _, value := range values {
			w.Header().Add(name, value)
		}
	}
	contentType := strings.TrimSpace(rec.header.Get("Content-Type"))
	if contentType == "" {
		contentType = fallbackContentType
	}
	h.writeConvertedImage(w, contentType, cacheControl, "miss", rec.code, body, cipher, key)
}

func (h *Handler) writeConvertedImage(w http.ResponseWriter, contentType, cacheControl, cacheStatus string, status int, body []byte, cipher *imageCipher, keyID string) {
	if cipher == nil || status < http.StatusOK || status >= http.StatusMultipleChoices || len(body) == 0 {
		writeImage(w, contentType, cacheControl, cacheStatus, status, body)
		return
	}

	encrypted, err := cipher.xor(body, keyID)
	if err != nil {
		h.logger.Error("failed to encrypt converted image", "error", err)
		writeImage(w, "text/plain; charset=utf-8", "", cacheStatus, http.StatusInternalServerError, []byte("internal server error\n"))
		return
	}
	w.Header().Set(imageEncryptionHeader, imageEncryptionAlgorithm)
	w.Header().Set(imageContentTypeHeader, contentType)
	w.Header().Set(imageKeyIDHeader, keyID)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	writeImage(w, "application/octet-stream", cacheControl, cacheStatus, status, encrypted)
}

func rewriteOriginRequest(r *http.Request, objectKey, contentType string) *http.Request {
	u := *r.URL
	u.Scheme = ""
	u.Host = ""
	u.Path = originPathPrefix + strings.TrimPrefix(objectKey, "/")
	u.RawPath = ""
	out := r.Clone(r.Context())
	out.URL = &u
	out.RequestURI = ""
	out.Header.Del(originContentTypeHeader)
	if contentType != "" {
		out.Header.Set(originContentTypeHeader, contentType)
	}
	return out
}

type limitedRecorder struct {
	header   http.Header
	code     int
	buf      bytes.Buffer
	limit    int
	overflow bool
}

func newLimitedRecorder(limit int) *limitedRecorder {
	return &limitedRecorder{
		header: make(http.Header),
		code:   http.StatusOK,
		limit:  limit,
	}
}

func (r *limitedRecorder) Header() http.Header { return r.header }

func (r *limitedRecorder) WriteHeader(code int) {
	if code != 0 {
		r.code = code
	}
}

func (r *limitedRecorder) Write(p []byte) (int, error) {
	if r.overflow {
		return 0, errConvertedTooLarge
	}
	if r.limit > 0 && r.buf.Len()+len(p) > r.limit {
		r.overflow = true
		r.buf.Reset()
		return 0, errConvertedTooLarge
	}
	return r.buf.Write(p)
}

func writeImage(w http.ResponseWriter, contentType, cacheControl, cacheStatus string, status int, body []byte) {
	if status == 0 {
		status = http.StatusOK
	}
	if status >= 200 && status < 300 {
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		if cacheControl != "" {
			w.Header().Set("Cache-Control", cacheControl)
		}
		setVary(w, cacheControl)
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.Header().Set(imageCacheHeader, cacheStatus)
	if len(body) > 0 {
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	}
	w.WriteHeader(status)
	if len(body) > 0 {
		_, _ = w.Write(body)
	}
}

func setVary(w http.ResponseWriter, cacheControl string) {
	vary := w.Header().Get("Vary")
	parts := make([]string, 0, 3)
	seen := map[string]struct{}{}
	for _, part := range strings.Split(vary, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		lower := strings.ToLower(part)
		if _, ok := seen[lower]; ok {
			continue
		}
		seen[lower] = struct{}{}
		parts = append(parts, part)
	}
	if _, ok := seen["accept"]; !ok {
		parts = append(parts, "Accept")
	}
	if strings.HasPrefix(cacheControl, "private") {
		if _, ok := seen["authorization"]; !ok {
			parts = append(parts, "Authorization")
		}
	}
	w.Header().Set("Vary", strings.Join(parts, ", "))
}
