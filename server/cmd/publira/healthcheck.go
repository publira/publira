package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
)

// healthcheck asks every URL it is given with a GET and succeeds only when
// each answers 200. It is what a container healthcheck runs, since the image
// carries no curl, and it is given the /readyz of both listeners of a
// `server --with-worker` process at once, so the URLs are asked side by side:
// one after the other, two slow checks would add up past the probe's timeout.
func healthcheck(args []string, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "healthcheck takes the URL of at least one /livez or /readyz")
	}
	for _, arg := range args {
		u, err := url.Parse(arg)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return usageError(stderr, fmt.Sprintf("healthcheck takes absolute http or https URLs, not %q", arg))
		}
	}
	errs := make([]error, len(args))
	var wg sync.WaitGroup
	for i, arg := range args {
		wg.Go(func() { errs[i] = probe(arg) })
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		_, _ = fmt.Fprintf(stderr, "publira: %v\n", err)
		return 1
	}
	return 0
}

// probe reports why target did not answer 200, with the body it answered
// instead, which for /readyz names the check that failed. Docker keeps what a
// healthcheck prints in `docker inspect`, so that is where an operator reads
// it.
func probe(target string) error {
	// The container healthcheck's timeout bounds the request.
	resp, err := http.Get(target)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusOK {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	return fmt.Errorf("%s answered %s: %s", target, resp.Status, body)
}
