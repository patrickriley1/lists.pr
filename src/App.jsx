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
  const [expandedAlbumId, setExpandedAlbumId] = useState(null);
  const [albumDetailsById, setAlbumDetailsById] = useState({});
  const [albumRatings, setAlbumRatings] = useState(() => {
    const savedRatings = localStorage.getItem("album_ratings");
    if (!savedRatings) return {};

    try {
      return JSON.parse(savedRatings);
    } catch {
      return {};
    }
  });
  const [savedAlbums, setSavedAlbums] = useState(() => {
    const storedAlbums = localStorage.getItem("saved_albums");
    if (!storedAlbums) return [];

    try {
      return JSON.parse(storedAlbums);
    } catch {
      return [];
    }
  });

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

  useEffect(() => {
    localStorage.setItem("album_ratings", JSON.stringify(albumRatings));
  }, [albumRatings]);

  useEffect(() => {
    localStorage.setItem("saved_albums", JSON.stringify(savedAlbums));
  }, [savedAlbums]);

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
          setExpandedAlbumId(null);
          return;
        }

        if (searchType === "track") {
          setResults(data.tracks?.items || []);
          setExpandedAlbumId(null);
          return;
        }

        setResults(data.artists?.items || []);
        setExpandedAlbumId(null);
      });
  }

  function toggleAlbumExpand(albumId) {
    if (expandedAlbumId === albumId) {
      setExpandedAlbumId(null);
      return;
    }

    setExpandedAlbumId(albumId);

    if (albumDetailsById[albumId]) return;

    setAlbumDetailsById((prev) => ({
      ...prev,
      [albumId]: { loading: true, tracks: [], releaseDate: "" },
    }));

    fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => res.json())
      .then((data) => {
        setAlbumDetailsById((prev) => ({
          ...prev,
          [albumId]: {
            loading: false,
            tracks: data.tracks?.items || [],
            releaseDate: data.release_date || "",
          },
        }));
      });
  }

  function rateAlbum(albumId) {
    const currentRating = albumRatings[albumId] ?? "";
    const newRating = window.prompt("Rate this album from 1 to 10", currentRating);

    if (newRating === null) return;

    const parsedRating = Number(newRating);
    if (Number.isNaN(parsedRating) || parsedRating < 1 || parsedRating > 10) return;

    setAlbumRatings((prev) => ({
      ...prev,
      [albumId]: parsedRating,
    }));
  }

  function addAlbumToList(album) {
    if (savedAlbums.some((savedAlbum) => savedAlbum.id === album.id)) return;

    setSavedAlbums((prev) => [
      ...prev,
      {
        id: album.id,
        name: album.name,
        artists: album.artists?.map((artist) => artist.name).join(", "),
      },
    ]);
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
                  setExpandedAlbumId(null);
                }}
              >
                Album Search
              </button>
              <button
                className={`searchCard ${searchType === "track" ? "active" : ""}`}
                onClick={() => {
                  setSearchType("track");
                  setResults([]);
                  setExpandedAlbumId(null);
                }}
              >
                Song Search
              </button>
              <button
                className={`searchCard ${searchType === "artist" ? "active" : ""}`}
                onClick={() => {
                  setSearchType("artist");
                  setResults([]);
                  setExpandedAlbumId(null);
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
              {results.map((item) => {
                const isAlbum = searchType === "album";
                const isExpanded = isAlbum && expandedAlbumId === item.id;
                const details = albumDetailsById[item.id];
                const releaseYear = details?.releaseDate
                  ? details.releaseDate.slice(0, 4)
                  : item.release_date?.slice(0, 4);

                return (
                  <div
                    key={item.id}
                    className={`resultItem ${isExpanded ? "expanded" : ""}`}
                    onClick={() => {
                      if (isAlbum) {
                        toggleAlbumExpand(item.id);
                      }
                    }}
                  >
                    <div className="resultMain">
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

                    {isExpanded ? (
                      <div className="albumExpanded">
                        <p>Released: {releaseYear || "Unknown"}</p>
                        <div className="albumActions">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              rateAlbum(item.id);
                            }}
                          >
                            {albumRatings[item.id] ? `Rated: ${albumRatings[item.id]}/10` : "Rate"}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addAlbumToList(item);
                            }}
                          >
                            {savedAlbums.some((savedAlbum) => savedAlbum.id === item.id)
                              ? "Added"
                              : "Add to List"}
                          </button>
                        </div>
                        <p>Tracklist</p>
                        {details?.loading ? (
                          <p>Loading tracks...</p>
                        ) : (
                          <ol className="trackList">
                            {(details?.tracks || []).map((track) => (
                              <li key={track.id || track.name}>{track.name}</li>
                            ))}
                          </ol>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
