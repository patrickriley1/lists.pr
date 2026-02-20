import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const clientID = "52ef8393bb03454a8d33998beacb0927";
  const redirectURI = "https://lists-pr.vercel.app";
  const authEndpoint = "https://accounts.spotify.com/authorize";
  const apiBaseURL = import.meta.env.VITE_API_URL || "http://localhost:4000";

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
  const [albumRatings, setAlbumRatings] = useState({});
  const [savedAlbums, setSavedAlbums] = useState([]);
  const [appUserId, setAppUserId] = useState(() => {
    const savedAppUserId = localStorage.getItem("app_user_id");
    if (!savedAppUserId) return null;
    const parsedId = Number(savedAppUserId);
    return Number.isNaN(parsedId) ? null : parsedId;
  });
  const [defaultListId, setDefaultListId] = useState(() => {
    const savedDefaultListId = localStorage.getItem("default_list_id");
    if (!savedDefaultListId) return null;
    const parsedId = Number(savedDefaultListId);
    return Number.isNaN(parsedId) ? null : parsedId;
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
    if (appUserId) {
      localStorage.setItem("app_user_id", String(appUserId));
      return;
    }

    localStorage.removeItem("app_user_id");
  }, [appUserId]);

  useEffect(() => {
    if (defaultListId) {
      localStorage.setItem("default_list_id", String(defaultListId));
      return;
    }

    localStorage.removeItem("default_list_id");
  }, [defaultListId]);

  useEffect(() => {
    if (!user?.id) return;

    fetch(`${apiBaseURL}/api/users/upsert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        spotify_id: user.id,
        display_name: user.display_name,
        email: user.email,
      }),
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to upsert user");
        }
        return res.json();
      })
      .then((dbUser) => {
        setAppUserId(dbUser.id);
      })
      .catch((error) => {
        console.error("Failed to sync user with backend", error);
      });
  }, [apiBaseURL, user]);

  useEffect(() => {
    if (!appUserId) return;

    Promise.all([
      fetch(`${apiBaseURL}/api/ratings/${appUserId}`),
      fetch(`${apiBaseURL}/api/lists/${appUserId}`),
    ])
      .then(async ([ratingsRes, listsRes]) => {
        const ratingsData = ratingsRes.ok ? await ratingsRes.json() : [];
        const listsData = listsRes.ok ? await listsRes.json() : [];
        return { ratingsData, listsData };
      })
      .then(({ ratingsData, listsData }) => {
        const ratingsMap = ratingsData.reduce((acc, ratingRow) => {
          acc[ratingRow.album_id] = ratingRow.rating;
          return acc;
        }, {});
        setAlbumRatings(ratingsMap);

        const preferredList = listsData.find((list) => list.name === "My List") || listsData[0];
        if (!preferredList) {
          setDefaultListId(null);
          setSavedAlbums([]);
          return;
        }

        setDefaultListId(preferredList.id);
        setSavedAlbums(
          (preferredList.items || []).map((item) => ({
            id: item.album_id,
            name: item.album_name,
            artists: item.artist_name || "",
          }))
        );
      })
      .catch((error) => {
        console.error("Failed to hydrate user data", error);
      });
  }, [apiBaseURL, appUserId]);

  async function ensureDefaultList() {
    if (!appUserId) return null;
    if (defaultListId) return defaultListId;

    const response = await fetch(`${apiBaseURL}/api/lists`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: appUserId,
        name: "My List",
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create default list");
    }

    const list = await response.json();
    setDefaultListId(list.id);
    return list.id;
  }

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

  async function rateAlbum(albumId) {
    if (!appUserId) return;

    const currentRating = albumRatings[albumId] ?? "";
    const newRating = window.prompt("Rate this album from 1 to 10", currentRating);

    if (newRating === null) return;

    const parsedRating = Number(newRating);
    if (Number.isNaN(parsedRating) || parsedRating < 1 || parsedRating > 10) return;

    const response = await fetch(`${apiBaseURL}/api/ratings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: appUserId,
        album_id: albumId,
        rating: parsedRating,
      }),
    });

    if (!response.ok) return;

    setAlbumRatings((prev) => ({
      ...prev,
      [albumId]: parsedRating,
    }));
  }

  async function addAlbumToList(album) {
    if (!appUserId) return;
    if (savedAlbums.some((savedAlbum) => savedAlbum.id === album.id)) return;

    const targetListId = await ensureDefaultList();
    if (!targetListId) return;

    const response = await fetch(`${apiBaseURL}/api/lists/${targetListId}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        album_id: album.id,
        album_name: album.name,
        artist_name: album.artists?.map((artist) => artist.name).join(", "),
      }),
    });

    if (!response.ok) return;

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
                              void rateAlbum(item.id);
                            }}
                          >
                            {albumRatings[item.id] ? `Rated: ${albumRatings[item.id]}/10` : "Rate"}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void addAlbumToList(item);
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
