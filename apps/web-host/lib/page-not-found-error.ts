export class PageNotFoundError extends Error {
  constructor() {
    super("ページが見つかりませんでした。");
    this.name = "PageNotFoundError";
  }
}
