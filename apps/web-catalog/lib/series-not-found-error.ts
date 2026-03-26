export class SeriesNotFoundError extends Error {
  constructor() {
    super("シリーズが見つかりませんでした。");
    this.name = "SeriesNotFoundError";
  }
}
