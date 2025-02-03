// /api/check-podcasts.js
import SpotifyWebApi from "spotify-web-api-node";

// Initialize Spotify API client
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
});

async function refreshAccessToken() {
  const data = await spotifyApi.refreshAccessToken();
  spotifyApi.setAccessToken(data.body["access_token"]);
}

async function getLatestEpisodes(showId) {
  try {
    //get 2 latest episodes
    const data = await spotifyApi.getShowEpisodes(showId, {limit: 2,});
    return data.body.items;
  } catch (error) {
    console.error(`Error getting episodes for show ${showId}:`, error);
    return [];
  }
}

async function getPlaylistEpisodes(playlistId) {
  try {
    const data = await spotifyApi.getPlaylistTracks(playlistId);
    return data.body.items.map((item) => item.track.uri);
  } catch (error) {
    console.error("Error getting playlist episodes:", error);
    return [];
  }
}

async function addEpisodeToPlaylist(playlistId, episodeUri) {
  try {
    await spotifyApi.addTracksToPlaylist(playlistId, [episodeUri]);
    console.log(`Added episode ${episodeUri} to playlist`);
  } catch (error) {
    console.error("Error adding episode to playlist:", error);
  }
}

export default async function handler(req, res) {
  try {
    // Only allow scheduled POST requests
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Verify the request is from Vercel Cron
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Refresh access token
    await refreshAccessToken();

    // Your configuration
    const PLAYLIST_ID = process.env.SPOTIFY_PLAYLIST_ID;
    const SHOW_IDS = process.env.SPOTIFY_SHOW_IDS.split(",");

    // Get existing episodes in playlist
    const existingEpisodes = await getPlaylistEpisodes(PLAYLIST_ID);

    // Check each show for new episodes
    for (const showId of SHOW_IDS) {
      const latestEpisodes = await getLatestEpisodes(showId);

      for (const episode of latestEpisodes) {
        if (!existingEpisodes.includes(episode.uri)) {
          await addEpisodeToPlaylist(PLAYLIST_ID, episode.uri);
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error in podcast checker:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
