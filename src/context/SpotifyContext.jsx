import { createContext, useContext, useRef } from "react";
import { apiFetch } from "../api";
import { useAuth } from "./AuthContext";

const SpotifyContext = createContext(null);

export function SpotifyProvider({ children }) {
  const { authToken } = useAuth();
  const tokenCacheRef = useRef({ accessToken: "", expiresAtMs: 0 });

  async function getSpotifyAccessToken() {
    if (!authToken) return null;
    const cached = tokenCacheRef.current;
    if (cached.accessToken && Date.now() < cached.expiresAtMs - 30_000) {
      return cached.accessToken;
    }
    try {
      const data = await apiFetch("/api/spotify/token", { token: authToken });
      if (!data?.access_token) return null;
      const expiresInSeconds = Number(data.expires_in || 3600);
      tokenCacheRef.current = {
        accessToken: data.access_token,
        expiresAtMs: Date.now() + expiresInSeconds * 1000,
      };
      return data.access_token;
    } catch {
      return null;
    }
  }

  async function spotifyApiFetch(path) {
    const accessToken = await getSpotifyAccessToken();
    if (!accessToken) return null;

    let response = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status !== 401) return response;

    // Token expired mid-session — clear cache and retry once.
    tokenCacheRef.current = { accessToken: "", expiresAtMs: 0 };
    const nextToken = await getSpotifyAccessToken();
    if (!nextToken) return null;

    response = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${nextToken}` },
    });
    return response;
  }

  return (
    <SpotifyContext.Provider value={{ spotifyApiFetch }}>
      {children}
    </SpotifyContext.Provider>
  );
}

export function useSpotify() {
  return useContext(SpotifyContext);
}
