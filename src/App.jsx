import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const clientID = "52ef8393bb03454a8d33998beacb0927";
  const redirectURI = "https://lists-pr.vercel.app";
  const authEndpoint = "https://accounts.spotify.com/authorize";

  const [token, setToken] = useState("");

  // ---------- PKCE HELPERS ----------

  function generateCodeVerifier(length = 64) {
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

    const randomValues = crypto.getRandomValues(new Uint8Array(length));

    return Array.from(randomValues)
      .map((x) => possible[x % possible.length])
      .join("");
  }

  async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);

    const base64 = btoa(
      String.fromCharCode(...new Uint8Array(digest))
    );

    return base64
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  // ---------- LOGIN FUNCTION ----------

  async function login() {
    const verifier = generateCodeVerifier();
    localStorage.setItem("spotify_verifier", verifier);

    const challenge = await generateCodeChallenge(verifier);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientID,
      redirect_uri: redirectURI,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: "user-read-private user-read-email",
    });

    window.location.href = `${authEndpoint}?${params.toString()}`;
  }

  // ---------- HANDLE REDIRECT + TOKEN EXCHANGE ----------

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");

    if (!code) return;

    const verifier = localStorage.getItem("spotify_verifier");

    fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientID,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectURI,
        code_verifier: verifier,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        setToken(data.access_token);
        window.history.replaceState({}, document.title, "/");
      });
  }, []);

  // ---------- UI ----------

  return (
    <div>
      <div className="header">
        <h1>lists.pr</h1>
        <div className="verticalLineSmall"></div>
      </div>

      <div className="body">
        {!token ? (
          <button onClick={login}>Login to Spotify</button>
        ) : (
          <p>Logged in. Token received.</p>
        )}
      </div>
    </div>
  );
}

export default App;
