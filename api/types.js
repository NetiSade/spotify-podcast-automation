export class SpotifyError extends Error {
  constructor(message, statusCode, spotifyError = null) {
    super(message);
    this.name = "SpotifyError";
    this.statusCode = statusCode;
    this.spotifyError = spotifyError;
  }
}
