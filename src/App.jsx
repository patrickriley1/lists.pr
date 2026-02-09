import { useEffect, useState } from 'react'
import './App.css'


function App() {
  const clientID = "52ef8393bb03454a8d33998beacb0927";
  const redirectURI = "https://lists-pr.vercel.app";
  const authEndpoint = "https://accounts.spotify.com/authorize";
  const responseType = "code";

  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  
  function generateCodeVerifier(length = 64) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  const randomValues = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(randomValues)
    .map((x) => possible[x % possible.length])
    .join("");
  }

  const codeVerifier = generateCodeVerifier();

  async function generateCodeChallenge(codeVerifier) {
  // Step 1: convert string to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);

  // Step 2: hash with SHA-256
  const digest = await crypto.subtle.digest("SHA-256", data);

  // Step 3: convert to base64url
  const base64 = btoa(
    String.fromCharCode(...new Uint8Array(digest))
  );

  // Make it URL-safe
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  }

  const codeChallenge = generateCodeChallenge(codeVerifier);

  useEffect(() => {
    if (code) {
      fetch(`https://accounts.spotify.com/api/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          code_verifier: codeVerifier,
          redirect_uri: redirectURI,
          client_id: clientID,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          setToken(data.access_token);
        });
    }
  }, [code]);

  useEffect(() => {
    setCode(new URLSearchParams(window.location.search).get("code"));
  }, [])

  useEffect(() => {
    if(code) {

    }
  }, [code]);

  return (
    <div>
      <div className='header'>
        <h1>lists.pr</h1>
        <div className='verticalLineSmall'></div>
      </div>
      <div className='body'>
        <a href={`${authEndpoint}?client_id=${clientID}&redirect_uri=${redirectURI}&response_type=${responseType}`}>Login to Spotify</a>
        <p>{code}</p>
        <p>{token}</p>
      </div>
    </div>
  )
}

export default App