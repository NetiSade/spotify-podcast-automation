import SpotifyWebApi from "spotify-web-api-node";
import { handleSpotifyRequest } from "./utils.js";
import {
  MY_SHOWS,
  NEW_SHOWS_LIMIT,
  OLD_EPISODES_DAYS,
  MAX_EPISODES_PER_SHOW,
} from "./consts.js";
import { SpotifyError } from "./types.js";

//TODO:
// - clean up the playlist from old episodes (done)
// - clean up the playlist from more then x episodes per show (done)

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

    // Your configuration
    const PLAYLIST_ID = process.env.SPOTIFY_PLAYLIST_ID;

    // Validate environment variables
    if (!PLAYLIST_ID) {
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

    // Get existing episodes in playlist
    console.log("Getting existing playlist episodes...");
    const playlistData = await handleSpotifyRequest(
      spotifyApi.getPlaylistTracks(PLAYLIST_ID),
      "get playlist tracks"
    );

    const existingEpisodes = playlistData.body.items
      .filter((item) => item.track && item.track.uri)
      .map((item) => ({
        id: item.track.id,
        uri: item.track.uri,
        addedAt: new Date(item.added_at),
        showId: item.track.artists[0].uri.split("show:")[1],
      }));

    console.log(`Found ${existingEpisodes.length} existing episodes`);

    // Check each show for new episodes
    let newEpisodesAdded = 0;
    const results = [];

    // Check each show for new episodes
    for (const showInfo of MY_SHOWS) {
      await handleShowEpisodes(
        showInfo,
        spotifyApi,
        PLAYLIST_ID,
        existingEpisodes,
        results,
        newEpisodesAdded
      );
    }

    // Clean up playlist from old episodes
    await cleanupOldEpisodes(PLAYLIST_ID, existingEpisodes, spotifyApi);

    // Clean up playlist from more then x episodes per show
    await cleanupMaxEpisodes(PLAYLIST_ID, existingEpisodes, spotifyApi);

    await cleanupCompleatedEpisodes(PLAYLIST_ID, existingEpisodes, spotifyApi);

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

const handleShowEpisodes = async (
  showInfo,
  spotifyApi,
  playlistId,
  existingEpisodes,
  results,
  newEpisodesAdded
) => {
  try {
    console.log(`Checking show "${showInfo.name}" for new episodes...`);

    const showId = showInfo.url.split("/show/")[1].split("?")[0];

    if (!showId) {
      console.log(`Invalid show URL: ${showInfo.url}`);
      return;
    }

    const showData = await handleSpotifyRequest(
      spotifyApi.getShowEpisodes(showId, {
        limit: NEW_SHOWS_LIMIT,
      }),
      `get episodes for show "${showInfo.name}"`
    );

    if (!showData.body.items || !showData.body.items.length) {
      console.log(`No episodes found for show "${showInfo.name}"`);
      return;
    }

    const latestEpisodes = showData.body.items;

    for (const episode of latestEpisodes) {
      if (!episode || !episode.uri || !episode.name) {
        continue;
      }
      if (existingEpisodes.some((ep) => ep.uri === episode.uri)) {
        console.log(
          `Episode "${episode.name}" from "${showInfo.name}" (${episode.uri}) already exists in playlist`
        );
        continue;
      }
      console.log(
        `Adding new episode: "${episode.name}" from "${showInfo.name}" (${episode.uri})`
      );
      await handleSpotifyRequest(
        spotifyApi.addTracksToPlaylist(playlistId, [episode.uri]),
        `add episode "${episode.name}" from "${showInfo.name}" to playlist`
      );
      newEpisodesAdded++;
    }
    console.log(
      `Added ${newEpisodesAdded} new episodes for show "${showInfo.name}"`
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

    const statusCode = error instanceof SpotifyError ? error.statusCode : 500;
    return res.status(statusCode).json({
      error: error.message,
      type: error.name,
      details: error.spotifyError,
    });
  }
};

const cleanupOldEpisodes = async (playlistId, existingEpisodes, spotifyApi) => {
  try {
    console.log("Cleaning up playlist from old episodes...");

    const oldEpisodes = existingEpisodes.filter(
      (episode) =>
        episode.addedAt <
        new Date(Date.now() - OLD_EPISODES_DAYS * 24 * 60 * 60 * 1000)
    );

    if (oldEpisodes.length === 0) {
      console.log("No old episodes found in playlist");
      return;
    }

    console.log(`Found ${oldEpisodes.length} old episodes in playlist`);

    await handleSpotifyRequest(
      spotifyApi.removeTracksFromPlaylist(
        playlistId,
        oldEpisodes.map((ep) => ({ uri: ep.uri }))
      ),
      `remove ${oldEpisodes.length} old episodes from playlist`
    );

    console.log("Playlist cleaned up successfully");
  } catch (error) {
    console.error("Error in playlist cleanup:", {
      message: error.message,
      name: error.name,
      statusCode: error.statusCode,
    });
  }
};

const cleanupMaxEpisodes = async (playlistId, existingEpisodes, spotifyApi) => {
  try {
    console.log(`Cleaning up playlist from more than ${MAX_EPISODES_PER_SHOW} episodes per show...`);

    const episodesPerShow = existingEpisodes.reduce((acc, episode) => {
      const showId = episode.showId;
      if (!acc[showId]) {
        acc[showId] = 0;
      }
      acc[showId]++;
      return acc;
    }, {});

    console.log('Episodes per show map:', episodesPerShow);

    const showsWithTooManyEpisodes = Object.entries(episodesPerShow).filter(
      ([, count]) => count > MAX_EPISODES_PER_SHOW
    );

    console.log('Shows with too many episodes', showsWithTooManyEpisodes);

    for (const [showId, count] of showsWithTooManyEpisodes) {
      console.log(`Show "${showId}" has ${count} episodes`);
      const episodesToRemove = count - MAX_EPISODES_PER_SHOW;
      // remove the oldest episodes
      const episodesToRemoveUris = existingEpisodes
        .filter((ep) => ep.showId === showId)
        .sort((a, b) => a.addedAt - b.addedAt)
        .slice(0, episodesToRemove)
        .map((ep) => ({ uri: ep.uri }));

      await handleSpotifyRequest(
        spotifyApi.removeTracksFromPlaylist(playlistId, episodesToRemoveUris),
        `remove ${episodesToRemove} episodes from show "${showId}"`
      );

      console.log(`Removed ${episodesToRemove} episodes from show "${showId}"`);
    }
  } catch (error) {
    console.error("Error in playlist cleanup:", {
      message: error.message,
      name: error.name,
      statusCode: error.statusCode,
    });
  }
};

const cleanupCompleatedEpisodes = async (playlistId, existingEpisodes, spotifyApi) => {
  try {
    const episodesIds = existingEpisodes.map(e => e.id);

    const episodesData = await handleSpotifyRequest(spotifyApi.getEpisodes(episodesIds), `get episodes data of ${episodesIds}`);

    console.log('cleanupCompleatedEpisodes - getEpisodes response', JSON.stringify(episodesData));

    if (!episodesData.body.episodes) {
      throw new Error(
        "episodesData is undefiend"
      );
    }

    const completedEpisodesUri = episodesData.body.episodes.filter(item =>
      item.episode.resume_point?.fully_played === true
    ).map(e => e.uri);


    await handleSpotifyRequest(
      spotifyApi.removeTracksFromPlaylist(playlistId, completedEpisodesUri),
      `remove ${completedEpisodesUri} episodes from playlist`
    );


  } catch (error) {
    console.error("Error in cleanupCompleatedEpisodes:", {
      message: error.message,
      name: error.name,
      statusCode: error.statusCode,
    });
  }
}
