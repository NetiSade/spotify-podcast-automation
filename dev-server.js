import express from "express";
import handler from "./api/check-podcasts.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Create a test endpoint
app.get("/api/check-podcasts", async (req, res) => {
  // Add the cron secret to the headers to simulate Vercel cron
  req.headers.authorization = `Bearer ${process.env.CRON_SECRET}`;

  try {
    await handler(req, res);
  } catch (error) {
    console.error("Error in handler:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add a simple GET endpoint for testing
app.get("/test", (req, res) => {
  res.json({ status: "Server is running!" });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("Environment check:");
  console.log("- SPOTIFY_CLIENT_ID exists:", !!process.env.SPOTIFY_CLIENT_ID);
  console.log(
    "- SPOTIFY_CLIENT_SECRET exists:",
    !!process.env.SPOTIFY_CLIENT_SECRET
  );
  console.log(
    "- SPOTIFY_REFRESH_TOKEN exists:",
    !!process.env.SPOTIFY_REFRESH_TOKEN
  );
  console.log(
    "- SPOTIFY_PLAYLIST_ID exists:",
    !!process.env.SPOTIFY_PLAYLIST_ID
  );
  console.log("- CRON_SECRET exists:", !!process.env.CRON_SECRET);
});
