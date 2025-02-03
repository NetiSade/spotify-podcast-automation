import SpotifyWebApi from "spotify-web-api-node";

// Constants
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/**
 * @typedef {Object} Config
 * @property {string} clientId - Spotify client ID
 * @property {string} clientSecret - Spotify client secret
 * @property {string} refreshToken - Spotify refresh token
 */

class SpotifyError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "SpotifyError";
    this.statusCode = statusCode;
  }
}

// Initialize Spotify API client
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
});

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Refreshes the Spotify access token
 * @throws {SpotifyError}
 */
async function refreshAccessToken() {
  try {
    const data = await spotifyApi.refreshAccessToken();
    if (!data.body["access_token"]) {
      throw new SpotifyError("No access token received", 401);
    }
    spotifyApi.setAccessToken(data.body["access_token"]);
  } catch (error) {
    throw new SpotifyError(
      `Failed to refresh access token: ${error.message}`,
      401
    );
  }
}

/**
 * Retries a function with exponential backoff
 * @template T
 * @param {function(): Promise<T>} fn - Function to retry
 * @param {number} [retries=MAX_RETRIES] - Number of retries
 * @returns {Promise<T>}
 */
async function withRetry(fn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(RETRY_DELAY * Math.pow(2, i));
    }
  }
}

/**
 * Gets the latest episodes for a show
 * @param {string} showId - Spotify show ID
 * @returns {Promise<Array>}
 */
async function getLatestEpisodes(showId) {
  if (!showId?.match(/^[0-9a-zA-Z]{22}$/)) {
    throw new SpotifyError(`Invalid show ID: ${showId}`, 400);
  }

  try {
    const data = await withRetry(() =>
      spotifyApi.getShowEpisodes(showId, { limit: 1 })
    );
    return data.body.items || [];
  } catch (error) {
    console.error(`Error getting episodes for show ${showId}:`, {
      error: error.message,
      stack: error.stack,
    });
    return [];
  }
}

/**
 * Gets episodes from a playlist
 * @param {string} playlistId - Spotify playlist ID
 * @returns {Promise<string[]>}
 */
async function getPlaylistEpisodes(playlistId) {
  if (!playlistId?.match(/^[0-9a-zA-Z]{22}$/)) {
    throw new SpotifyError(`Invalid playlist ID: ${playlistId}`, 400);
  }

  try {
    const data = await withRetry(() =>
      spotifyApi.getPlaylistTracks(playlistId)
    );
    return data.body.items.map((item) => item.track?.uri).filter(Boolean);
  } catch (error) {
    console.error("Error getting playlist episodes:", {
      error: error.message,
      stack: error.stack,
      playlistId,
    });
    return [];
  }
}

/**
 * Adds an episode to a playlist
 * @param {string} playlistId - Spotify playlist ID
 * @param {string} episodeUri - Spotify episode URI
 */
async function addEpisodeToPlaylist(playlistId, episodeUri) {
  if (!episodeUri?.startsWith("spotify:episode:")) {
    throw new SpotifyError(`Invalid episode URI: ${episodeUri}`, 400);
  }

  try {
    await withRetry(() =>
      spotifyApi.addTracksToPlaylist(playlistId, [episodeUri])
    );
    console.log("Successfully added episode to playlist", {
      episodeUri,
      playlistId,
    });
  } catch (error) {
    console.error("Error adding episode to playlist:", {
      error: error.message,
      stack: error.stack,
      episodeUri,
      playlistId,
    });
    throw error;
  }
}

/**
 * Main handler for the API endpoint
 */
export default async function handler(req, res) {
  try {
    // Validate request method
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Validate environment variables
    const PLAYLIST_ID = process.env.SPOTIFY_PLAYLIST_ID;
    const SHOW_IDS = process.env.SPOTIFY_SHOW_IDS?.split(",").filter(Boolean);

    if (!PLAYLIST_ID || !SHOW_IDS?.length) {
      throw new Error("Missing required environment variables");
    }

    await refreshAccessToken();

    // Get existing episodes in playlist
    const existingEpisodes = await getPlaylistEpisodes(PLAYLIST_ID);

    // Process each show
    const results = await Promise.all(
      SHOW_IDS.map(async (showId) => {
        try {
          const latestEpisodes = await getLatestEpisodes(showId);

          for (const episode of latestEpisodes) {
            if (episode.uri && !existingEpisodes.includes(episode.uri)) {
              await addEpisodeToPlaylist(PLAYLIST_ID, episode.uri);
            }
          }
          return { showId, success: true };
        } catch (error) {
          return { showId, success: false, error: error.message };
        }
      })
    );

    return res.status(200).json({
      success: true,
      results,
    });
  } catch (error) {
    console.error("Error in podcast checker:", {
      error: error.message,
      stack: error.stack,
    });

    const statusCode = error instanceof SpotifyError ? error.statusCode : 500;
    return res.status(statusCode).json({
      error: error.message,
      type: error.name,
    });
  }
}
