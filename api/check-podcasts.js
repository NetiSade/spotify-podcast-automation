import SpotifyWebApi from "spotify-web-api-node";

class SpotifyError extends Error {
  constructor(message, statusCode, spotifyError = null) {
    super(message);
    this.name = "SpotifyError";
    this.statusCode = statusCode;
    this.spotifyError = spotifyError;
  }
}

async function handleSpotifyRequest(promise, operation) {
  try {
    const response = await promise;
    return response;
  } catch (error) {
    console.error(`Error during ${operation}:`, {
      message: error.message,
      body: error.body,
      statusCode: error.statusCode,
    });
    throw new SpotifyError(
      `Failed to ${operation}`,
      error.statusCode || 500,
      error
    );
  }
}

export default async function handler(req, res) {
  try {
    // Only allow scheduled POST requests
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Verify the request is from Vercel Cron
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Validate environment variables
    if (!process.env.SPOTIFY_PLAYLIST_ID) {
      throw new Error(
        "Missing required environment variable: SPOTIFY_PLAYLIST_ID"
      );
    }

    // Initialize Spotify API client
    const spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
    });

    console.log("Spotify API Configuration:", {
      clientIdLength: process.env.SPOTIFY_CLIENT_ID?.length || 0,
      clientSecretLength: process.env.SPOTIFY_CLIENT_SECRET?.length || 0,
      refreshTokenLength: process.env.SPOTIFY_REFRESH_TOKEN?.length || 0,
    });

    // Refresh access token
    console.log("Refreshing access token...");
    const tokenData = await handleSpotifyRequest(
      spotifyApi.refreshAccessToken(),
      "refresh access token"
    );

    if (!tokenData.body["access_token"]) {
      throw new Error("No access token received from Spotify");
    }

    spotifyApi.setAccessToken(tokenData.body["access_token"]);
    console.log("Access token refreshed successfully");

    // Your configuration
    const PLAYLIST_ID = process.env.SPOTIFY_PLAYLIST_ID;

    const GENERAL_SHOW_URLS = [
      {
        name: "How To Do Things",
        url: "https://open.spotify.com/show/3JVB81Ce5eXH8dgVKe6A57?si=abc123",
      },
      {
        name: "היידה",
        url: "https://open.spotify.com/show/0VeR5mYtFCTfSCa7SCVH83?si=def456",
      },
      {
        name: "וויקליסינק",
        url: "https://open.spotify.com/show/674Fd3udoDREXmBq44dHWY?si=dc3279b7d877434b",
      },
      {
        name: "OnePlusOne",
        url: "https://open.spotify.com/show/1jMmrLogjWyQEYPDHf5INh?si=xyz789",
      },
      {
        name: "הקרנף",
        url: "https://open.spotify.com/show/6bcWODxao3AI48YzWpF6g5?si=1234567890",
      },
    ];

    // Extract show IDs from URLs, removing any query parameters
    const showIds = GENERAL_SHOW_URLS.map(
      (show) => show.url.split("/show/")[1].split("?")[0]
    );

    // Get existing episodes in playlist
    console.log("Getting existing playlist episodes...");
    const playlistData = await handleSpotifyRequest(
      spotifyApi.getPlaylistTracks(PLAYLIST_ID),
      "get playlist tracks"
    );

    const existingEpisodes = playlistData.body.items
      .filter((item) => item.track && item.track.uri)
      .map((item) => item.track.uri);

    console.log(`Found ${existingEpisodes.length} existing episodes`);

    // Check each show for new episodes
    let newEpisodesAdded = 0;
    const results = [];

    // Handle general shows first
    for (const showId of showIds) {
      try {
        const showInfo = GENERAL_SHOW_URLS.find((show) =>
          show.url.includes(showId)
        );
        console.log(
          `Checking show "${showInfo.name}" (${showId}) for new episodes...`
        );
        const showData = await handleSpotifyRequest(
          spotifyApi.getShowEpisodes(showId, {
            limit: 1,
          }),
          `get episodes for show "${showInfo.name}"`
        );

        if (!showData.body.items || !showData.body.items.length) {
          console.log(`No episodes found for show "${showInfo.name}"`);
          continue;
        }

        const latestEpisodes = showData.body.items;

        for (const episode of latestEpisodes) {
          if (!episode || !episode.uri) {
            console.log(`Invalid episode data for show "${showInfo.name}"`);
            continue;
          }

          if (!existingEpisodes.includes(episode.uri)) {
            console.log(
              `Adding new episode: "${episode.name}" from "${showInfo.name}" (${episode.uri})`
            );
            await handleSpotifyRequest(
              spotifyApi.addTracksToPlaylist(PLAYLIST_ID, [episode.uri]),
              `add episode "${episode.name}" from "${showInfo.name}" to playlist`
            );
            newEpisodesAdded++;
          }
        }

        console.log(
          `Found ${latestEpisodes.length} episodes for show "${showInfo.name}"`
        );

        results.push({ showId, showName: showInfo.name, success: true });
      } catch (error) {
        console.error("Error in podcast checker:", {
          message: error.message,
          name: error.name,
          statusCode: error.statusCode,
          spotifyError: error.spotifyError,
          stack: error.stack,
          envCheck: {
            hasClientId: !!process.env.SPOTIFY_CLIENT_ID,
            hasClientSecret: !!process.env.SPOTIFY_CLIENT_SECRET,
            hasRefreshToken: !!process.env.SPOTIFY_REFRESH_TOKEN,
          },
        });

        const statusCode =
          error instanceof SpotifyError ? error.statusCode : 500;
        return res.status(statusCode).json({
          error: error.message,
          type: error.name,
          details: error.spotifyError,
        });
      }
    }

    return res.status(200).json({
      success: true,
      newEpisodesAdded,
      results,
      message: `Successfully checked for new episodes. Added ${newEpisodesAdded} new episodes.`,
    });
  } catch (error) {
    console.error("Error in podcast checker:", {
      message: error.message,
      name: error.name,
      statusCode: error.statusCode,
      spotifyError: error.spotifyError,
      stack: error.stack,
    });

    const statusCode = error instanceof SpotifyError ? error.statusCode : 500;
    return res.status(statusCode).json({
      error: error.message,
      type: error.name,
      details: error.spotifyError,
    });
  }
}
