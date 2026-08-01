export class EpisodeNotFoundError extends Error {
  constructor() {
    super("エピソードが見つかりませんでした。");
    this.name = "EpisodeNotFoundError";
  }
}
