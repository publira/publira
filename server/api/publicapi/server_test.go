package publicapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestPublicHandlerExposesOnlyPublicRoutes は、NewHandler が公開 API (CatalogService, AuthService) だけ
// 公開し、管理 API (AdminSeriesService) は登録しないことを検証する。
func TestPublicHandlerExposesOnlyPublicRoutes(t *testing.T) {
	ts := httptest.NewServer(NewHandler(nil, nil))
	t.Cleanup(ts.Close)

	assertRouteStatus(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", false)
	assertRouteStatus(t, ts, "/publira.v1.AuthService/GetMe", false)
	assertRouteStatus(t, ts, "/publira.v1.AdminSeriesService/ListSeries", true)
}

func assertRouteStatus(t *testing.T, ts *httptest.Server, path string, wantNotFound bool) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, ts.URL+path, nil)
	if err != nil {
		t.Fatalf("http.NewRequest: %v", err)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	_ = resp.Body.Close()

	gotNotFound := resp.StatusCode == http.StatusNotFound
	if gotNotFound != wantNotFound {
		t.Fatalf("path %s status = %d, not_found = %v, want not_found = %v", path, resp.StatusCode, gotNotFound, wantNotFound)
	}
}
