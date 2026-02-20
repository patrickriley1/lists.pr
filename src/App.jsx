import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const clientID = "52ef8393bb03454a8d33998beacb0927";
  const redirectURI = "https://lists-pr.vercel.app";
  const authEndpoint = "https://accounts.spotify.com/authorize";

  const [token, setToken] = useState(() => localStorage.getItem("spotify_token") || "");


  //user info variables
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem("spotify_user");
    if (!savedUser) return "";

    try {
      return JSON.parse(savedUser);
    } catch {
      return "";
    }
  });


  // Search variables
  const [search, setSearch] = useState("");
  const [searchType, setSearchType] = useState("album");
  const [results, setResults] = useState([]);

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
        localStorage.setItem("spotify_token", data.access_token);
        setToken(data.access_token);
        window.history.replaceState({}, document.title, "/");
      });
  }, []);

  useEffect(() => {
    if (!token) return;

    fetch("https://api.spotify.com/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => res.json())
      .then((data) => {
        localStorage.setItem("spotify_user", JSON.stringify(data));
        setUser(data);
      });
  }, [token]);

  function searchSpotify() {
    if (!search.trim()) return;

    fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(search)}&type=${searchType}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => res.json())
      .then((data) => {
        if (searchType === "album") {
          setResults(data.albums?.items || []);
          return;
        }

        if (searchType === "track") {
          setResults(data.tracks?.items || []);
          return;
        }

        setResults(data.artists?.items || []);
      });
  }




  // ---------- UI ----------

  return (
    <div>
      <div className="header">
        <h1>lists.pr</h1>
        <div className="verticalLineSmall"></div>
        {token && user?.display_name ? (
          <p className="usernameTopRight">{user.display_name}</p>
        ) : null}
      </div>

      <div className="body">
        {!token ? (
          <button onClick={login}>Login to Spotify</button>
        ) : (
          <div className="searchSection">
            <div className="searchCards">
              <button
                className={`searchCard ${searchType === "album" ? "active" : ""}`}
                onClick={() => {
                  setSearchType("album");
                  setResults([]);
                }}
              >
                Album Search
              </button>
              <button
                className={`searchCard ${searchType === "track" ? "active" : ""}`}
                onClick={() => {
                  setSearchType("track");
                  setResults([]);
                }}
              >
                Song Search
              </button>
              <button
                className={`searchCard ${searchType === "artist" ? "active" : ""}`}
                onClick={() => {
                  setSearchType("artist");
                  setResults([]);
                }}
              >
                Artist Search
              </button>
            </div>
            <div className="searchBar">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    searchSpotify();
                  }
                }}
                placeholder={`Search for a ${searchType === "track" ? "song" : searchType}`}
              />
              <button onClick={searchSpotify}>
                Search
              </button>
            </div>
            <div className="resultsList">
              {results.map((item) => (
                <div key={item.id} className="resultItem">
                  <img
                    src={
                      searchType === "track"
                        ? item.album?.images?.[0]?.url
                        : item.images?.[0]?.url
                    }
                    width="80"
                  />
                  <div className="resultInfo">
                    <p>{item.name}</p>
                    <p>
                      {searchType === "artist"
                        ? "Artist"
                        : item.artists?.map((artist) => artist.name).join(", ")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
