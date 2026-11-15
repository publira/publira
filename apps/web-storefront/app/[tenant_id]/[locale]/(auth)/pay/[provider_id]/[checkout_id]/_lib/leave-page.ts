/**
 * Sends the reader to `url` as a new document load rather than a client
 * navigation: a checkout's success and cancel URLs are not always pages of the
 * site, since a checkout started from the app returns the reader to a link the
 * app opens.
 */
export const leavePage = (url: string): void => {
  window.location.assign(url);
};
