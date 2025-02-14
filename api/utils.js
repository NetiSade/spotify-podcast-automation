export async function handleSpotifyRequest(promise, operation) {
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
