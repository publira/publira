package imageserver

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
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
	originReadHeaderTimeout = 5 * time.Second
	originShutdownTimeout   = 5 * time.Second
)

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

func (h *Handler) serveConverted(w http.ResponseWriter, r *http.Request, objectKey, fallbackContentType, cacheControl string) {
	key := cacheKey(objectKey, r)
	if entry, ok := h.cache.Get(r.Context(), key); ok {
		writeImage(w, entry.ContentType, cacheControl, "hit", http.StatusOK, entry.Data)
		return
	}

	rec := httptest.NewRecorder()
	h.proxy.ServeHTTP(rec, rewriteOriginRequest(r, objectKey, fallbackContentType))

	body := rec.Body.Bytes()
	if rec.Code == http.StatusOK && len(body) > 0 {
		contentType := strings.TrimSpace(rec.Header().Get("Content-Type"))
		if contentType == "" {
			contentType = fallbackContentType
		}
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		h.cache.Set(r.Context(), key, CacheEntry{ContentType: contentType, Data: append([]byte(nil), body...)})
	}

	for name, values := range rec.Header() {
		if strings.EqualFold(name, "Content-Length") {
			continue
		}
		for _, value := range values {
			w.Header().Add(name, value)
		}
	}
	contentType := strings.TrimSpace(rec.Header().Get("Content-Type"))
	if contentType == "" {
		contentType = fallbackContentType
	}
	writeImage(w, contentType, cacheControl, "miss", rec.Code, body)
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
	if contentType != "" {
		out.Header.Set(originContentTypeHeader, contentType)
	}
	return out
}

func writeImage(w http.ResponseWriter, contentType, cacheControl, cacheStatus string, status int, body []byte) {
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	if cacheControl != "" {
		w.Header().Set("Cache-Control", cacheControl)
	}
	setVary(w, cacheControl)
	w.Header().Set(imageCacheHeader, cacheStatus)
	if len(body) > 0 {
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	}
	if status == 0 {
		status = http.StatusOK
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
