import SpotifyWebApi from "spotify-web-api-node";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 8888;

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: `http://localhost:${PORT}/callback`,
});

// Create the authorization URL
const scopes = [
  "playlist-modify-public",
  "playlist-modify-private",
  "playlist-read-private",
];

app.get("/login", (req, res) => {
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
  res.redirect(authorizeURL);
});

app.get("/callback", async (req, res) => {
  const error = req.query.error;
  const code = req.query.code;

  if (error) {
    console.error("Callback Error:", error);
    res.send(`Callback Error: ${error}`);
    return;
  }

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const accessToken = data.body["access_token"];
    const refreshToken = data.body["refresh_token"];

    console.log("\n=== Tokens ===");
    console.log("Refresh Token:", refreshToken);
    console.log("Access Token:", accessToken);
    console.log("\n=== Add this to your .env file ===");
    console.log(`SPOTIFY_REFRESH_TOKEN=${refreshToken}`);

    res.send("Success! Check your console for the refresh token.");
  } catch (error) {
    console.error("Error getting tokens:", error);
    res.send(`Error getting tokens: ${error}`);
  }
});

app.listen(PORT, () => {
  console.log(`\n=== Instructions ===`);
  console.log(`1. Visit http://localhost:${PORT}/login`);
  console.log("2. Log in to Spotify if prompted");
  console.log(
    "3. Check this console after authorization for your refresh token\n"
  );
});
