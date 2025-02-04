import SpotifyWebApi from "spotify-web-api-node";
import dotenv from "dotenv";
dotenv.config();

// Log environment variables (but hide sensitive parts)
console.log("Environment variables check:");
console.log("SPOTIFY_CLIENT_ID exists:", !!process.env.SPOTIFY_CLIENT_ID);
console.log(
  "SPOTIFY_CLIENT_SECRET exists:",
  !!process.env.SPOTIFY_CLIENT_SECRET
);
console.log(
  "SPOTIFY_REFRESH_TOKEN exists:",
  !!process.env.SPOTIFY_REFRESH_TOKEN
);
console.log(
  "SPOTIFY_REFRESH_TOKEN length:",
  process.env.SPOTIFY_REFRESH_TOKEN?.length || 0
);

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
});

async function testSpotifyConnection() {
  try {
    console.log("\nTrying to refresh access token...");
    const data = await spotifyApi.refreshAccessToken();
    console.log("Successfully refreshed access token");

    spotifyApi.setAccessToken(data.body["access_token"]);
    console.log("Access token set successfully");

    // Try to get user's profile as a basic test
    const me = await spotifyApi.getMe();
    console.log(
      "\nSuccessfully connected to Spotify as:",
      me.body.display_name
    );
  } catch (error) {
    console.error("\nError details:", {
      message: error.message,
      body: error.body,
      statusCode: error.statusCode,
    });
  }
}

testSpotifyConnection();
