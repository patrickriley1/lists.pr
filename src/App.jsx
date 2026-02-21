import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import "./App.css";

function App() {
  const clientID = "52ef8393bb03454a8d33998beacb0927";
  const redirectURI = "https://lists-pr.vercel.app";
  const authEndpoint = "https://accounts.spotify.com/authorize";
  const apiBaseURL = import.meta.env.VITE_API_URL || "http://localhost:4000";

  const navigate = useNavigate();
  const location = useLocation();

  const [token, setToken] = useState(() => localStorage.getItem("spotify_token") || "");
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem("spotify_user");
    if (!savedUser) return "";

    try {
      return JSON.parse(savedUser);
    } catch {
      return "";
    }
  });

  const [authToken, setAuthToken] = useState(() => localStorage.getItem("app_auth_token") || "");
  const [authUser, setAuthUser] = useState(() => {
    const savedAuthUser = localStorage.getItem("app_auth_user");
    if (!savedAuthUser) return null;

    try {
      return JSON.parse(savedAuthUser);
    } catch {
      return null;
    }
  });
  const [linkedSpotifyUserId, setLinkedSpotifyUserId] = useState(() => {
    const parsed = Number(localStorage.getItem("linked_spotify_user_id"));
    return Number.isNaN(parsed) ? null : parsed;
  });

  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [authError, setAuthError] = useState("");

  const [search, setSearch] = useState("");
  const [searchType, setSearchType] = useState("album");
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [expandedAlbumId, setExpandedAlbumId] = useState(null);
  const [albumDetailsById, setAlbumDetailsById] = useState({});
  const [albumRatings, setAlbumRatings] = useState({});
  const [ratingEntries, setRatingEntries] = useState([]);
  const [savedAlbums, setSavedAlbums] = useState([]);
  const [defaultListId, setDefaultListId] = useState(() => {
    const parsed = Number(localStorage.getItem("default_list_id"));
    return Number.isNaN(parsed) ? null : parsed;
  });

  const canUseApp = Boolean(authToken && token && linkedSpotifyUserId);

  function getAuthHeaders() {
    if (!authToken) return {};
    return { Authorization: `Bearer ${authToken}` };
  }

  function clearAuthState() {
    setAuthToken("");
    setAuthUser(null);
    setLinkedSpotifyUserId(null);
    setDefaultListId(null);
    setAlbumRatings({});
    setRatingEntries([]);
    setSavedAlbums([]);
    localStorage.removeItem("app_auth_token");
    localStorage.removeItem("app_auth_user");
    localStorage.removeItem("linked_spotify_user_id");
    localStorage.removeItem("default_list_id");
  }

  function logout() {
    clearAuthState();
    setToken("");
    setUser("");
    localStorage.removeItem("spotify_token");
    localStorage.removeItem("spotify_user");
    localStorage.removeItem("spotify_verifier");
    navigate("/");
  }

  function generateCodeVerifier(length = 64) {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const randomValues = crypto.getRandomValues(new Uint8Array(length));

    return Array.from(randomValues)
      .map((x) => possible[x % possible.length])
      .join("");
  }

  async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));

    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function loginSpotify() {
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

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError("");

    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";

    try {
      const response = await fetch(`${apiBaseURL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(authForm),
      });

      const data = await response.json();
      if (!response.ok) {
        setAuthError(data.error || "Authentication failed");
        return;
      }

      setAuthToken(data.token);
      setAuthUser(data.user);
      setLinkedSpotifyUserId(data.user.spotify_user_id || null);
      localStorage.setItem("app_auth_token", data.token);
      localStorage.setItem("app_auth_user", JSON.stringify(data.user));

      if (data.user.spotify_user_id) {
        localStorage.setItem("linked_spotify_user_id", String(data.user.spotify_user_id));
      } else {
        localStorage.removeItem("linked_spotify_user_id");
      }

      navigate("/");
    } catch (error) {
      setAuthError("Authentication request failed");
      console.error(error);
    }
  }

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
    if (!authToken) return;

    fetch(`${apiBaseURL}/api/auth/me`, {
      headers: {
        ...getAuthHeaders(),
      },
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Invalid auth session");
        }
        return res.json();
      })
      .then((data) => {
        setAuthUser(data);
        setLinkedSpotifyUserId(data.spotify_user_id || null);
        localStorage.setItem("app_auth_user", JSON.stringify(data));

        if (data.spotify_user_id) {
          localStorage.setItem("linked_spotify_user_id", String(data.spotify_user_id));
        } else {
          localStorage.removeItem("linked_spotify_user_id");
        }
      })
      .catch(() => {
        clearAuthState();
      });
  }, [apiBaseURL, authToken]);

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
    if (!authToken || !user?.id) return;

    fetch(`${apiBaseURL}/api/users/upsert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        spotify_id: user.id,
        display_name: user.display_name,
        email: user.email,
      }),
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to link Spotify account");
        }
        return res.json();
      })
      .then((data) => {
        const spotifyUserId = data.spotify_user_id;
        setLinkedSpotifyUserId(spotifyUserId);
        localStorage.setItem("linked_spotify_user_id", String(spotifyUserId));

        setAuthUser((prev) => {
          const nextUser = { ...(prev || {}), spotify_user_id: spotifyUserId };
          localStorage.setItem("app_auth_user", JSON.stringify(nextUser));
          return nextUser;
        });
      })
      .catch((error) => {
        console.error(error);
      });
  }, [apiBaseURL, authToken, user]);

  useEffect(() => {
    if (defaultListId) {
      localStorage.setItem("default_list_id", String(defaultListId));
      return;
    }

    localStorage.removeItem("default_list_id");
  }, [defaultListId]);

  useEffect(() => {
    if (!authToken || !linkedSpotifyUserId) return;

    Promise.all([
      fetch(`${apiBaseURL}/api/ratings`, {
        headers: {
          ...getAuthHeaders(),
        },
      }),
      fetch(`${apiBaseURL}/api/lists`, {
        headers: {
          ...getAuthHeaders(),
        },
      }),
    ])
      .then(async ([ratingsRes, listsRes]) => {
        const ratingsData = ratingsRes.ok ? await ratingsRes.json() : [];
        const listsData = listsRes.ok ? await listsRes.json() : [];
        return { ratingsData, listsData };
      })
      .then(({ ratingsData, listsData }) => {
        setRatingEntries(ratingsData);

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
  }, [apiBaseURL, authToken, linkedSpotifyUserId]);

  async function ensureDefaultList() {
    if (!defaultListId) {
      const response = await fetch(`${apiBaseURL}/api/lists`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
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

    return defaultListId;
  }

  async function searchSpotify() {
    if (!search.trim() || !token) return;

    setSearchLoading(true);
    setSearchError("");

    try {
      const response = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(search)}&type=${searchType}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          setSearchError("Spotify session expired. Please link Spotify again.");
          setToken("");
          setUser("");
          localStorage.removeItem("spotify_token");
          localStorage.removeItem("spotify_user");
          return;
        }

        setSearchError("Search failed. Please try again.");
        return;
      }

      const data = await response.json();

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
    } catch {
      setSearchError("Search failed. Check your connection and try again.");
    } finally {
      setSearchLoading(false);
    }
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
    if (!authToken || !linkedSpotifyUserId) return;

    const currentRating = albumRatings[albumId] ?? "";
    const newRating = window.prompt("Rate this album from 1 to 10", currentRating);

    if (newRating === null) return;

    const parsedRating = Number(newRating);
    if (Number.isNaN(parsedRating) || parsedRating < 1 || parsedRating > 10) return;

    const response = await fetch(`${apiBaseURL}/api/ratings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        album_id: albumId,
        rating: parsedRating,
      }),
    });

    if (!response.ok) return;

    setAlbumRatings((prev) => ({
      ...prev,
      [albumId]: parsedRating,
    }));

    setRatingEntries((prev) => {
      const rest = prev.filter((entry) => entry.album_id !== albumId);
      return [{ album_id: albumId, rating: parsedRating }, ...rest];
    });
  }

  async function addAlbumToList(album) {
    if (!authToken || !linkedSpotifyUserId) return;
    if (savedAlbums.some((savedAlbum) => savedAlbum.id === album.id)) return;

    const targetListId = await ensureDefaultList();
    if (!targetListId) return;

    const response = await fetch(`${apiBaseURL}/api/lists/${targetListId}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
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

  function renderAuthCard() {
    return (
      <form className="authCard" onSubmit={submitAuth}>
        <h2>{authMode === "register" ? "Create Account" : "Login"}</h2>
        <input
          value={authForm.username}
          onChange={(e) =>
            setAuthForm((prev) => ({
              ...prev,
              username: e.target.value,
            }))
          }
          placeholder="Username"
        />
        <input
          type="password"
          value={authForm.password}
          onChange={(e) =>
            setAuthForm((prev) => ({
              ...prev,
              password: e.target.value,
            }))
          }
          placeholder="Password"
        />
        {authError ? <p className="authError">{authError}</p> : null}
        <div className="authActions">
          <button type="submit">{authMode === "register" ? "Register" : "Login"}</button>
          <button
            type="button"
            onClick={() => {
              setAuthError("");
              setAuthMode((prev) => (prev === "login" ? "register" : "login"));
            }}
          >
            {authMode === "login" ? "Need an account?" : "Have an account?"}
          </button>
        </div>
      </form>
    );
  }

  function renderLinkSpotifyCard() {
    return (
      <div className="authCard">
        <h2>Link Spotify</h2>
        <p>Login succeeded. Link your Spotify account to continue.</p>
        <div className="authActions">
          <button onClick={loginSpotify}>Link Spotify Account</button>
          <button onClick={logout}>Logout</button>
        </div>
      </div>
    );
  }

  function renderSearchPage() {
    if (!canUseApp) {
      return <Navigate to="/" replace />;
    }

    return (
      <div className="searchSection">
        <h2 className="pageTitle">Search</h2>
        <div className="searchCards">
          <button
            className={`searchCard ${searchType === "album" ? "active" : ""}`}
            type="button"
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
            type="button"
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
            type="button"
            onClick={() => {
              setSearchType("artist");
              setResults([]);
              setExpandedAlbumId(null);
            }}
          >
            Artist Search
          </button>
        </div>
        <form
          className="searchBar"
          onSubmit={(e) => {
            e.preventDefault();
            void searchSpotify();
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search for a ${searchType === "track" ? "song" : searchType}`}
          />
          <button type="submit" disabled={searchLoading}>
            {searchLoading ? "Searching..." : "Search"}
          </button>
        </form>
        {searchError ? <p className="authError">{searchError}</p> : null}
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
                      searchType === "track" ? item.album?.images?.[0]?.url : item.images?.[0]?.url
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
    );
  }

  function renderLibraryPage() {
    if (!canUseApp) {
      return <Navigate to="/" replace />;
    }

    return (
      <div className="libraryPage">
        <h2 className="pageTitle">Library / Profile</h2>
        <div className="libraryGrid">
          <div className="myListsPanel">
            <h3>My List</h3>
            {savedAlbums.length === 0 ? (
              <p>No albums saved yet.</p>
            ) : (
              <div className="myListItems">
                {savedAlbums.map((album) => (
                  <div key={album.id} className="myListItem">
                    <p>{album.name}</p>
                    <p>{album.artists}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="myListsPanel">
            <h3>My Reviews</h3>
            {ratingEntries.length === 0 ? (
              <p>No ratings yet.</p>
            ) : (
              <div className="myListItems">
                {ratingEntries.map((entry) => (
                  <div key={`${entry.album_id}-${entry.rating}`} className="myListItem">
                    <p>Album ID: {entry.album_id}</p>
                    <p>Rating: {entry.rating}/10</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderHomePage() {
    if (!authToken) {
      return (
        <div className="pageSection">
          <h2 className="pageTitle">Home</h2>
          <p className="pageIntro">Create an account or sign in to start building your music library.</p>
          {renderAuthCard()}
        </div>
      );
    }

    if (!token || !linkedSpotifyUserId) {
      return (
        <div className="pageSection">
          <h2 className="pageTitle">Home</h2>
          <p className="pageIntro">Your app account is ready. Link Spotify to unlock search and library pages.</p>
          {renderLinkSpotifyCard()}
        </div>
      );
    }

    return (
      <div className="pageSection">
        <h2 className="pageTitle">Home</h2>
        <p className="pageIntro">Welcome back, {authUser?.username}. Pick a page to continue.</p>
        <div className="homeActions">
          <Link className="searchCard active" to="/search">
            Go to Search
          </Link>
          <Link className="searchCard" to="/library">
            Go to Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="header">
        <h1>lists.pr</h1>
        <div className="verticalLineSmall"></div>
        <nav className="topNav">
          <Link className={location.pathname === "/" ? "navLink active" : "navLink"} to="/">
            Home
          </Link>
          <Link
            className={location.pathname === "/search" ? "navLink active" : "navLink"}
            to="/search"
          >
            Search
          </Link>
          <Link
            className={location.pathname === "/library" ? "navLink active" : "navLink"}
            to="/library"
          >
            Library/Profile
          </Link>
        </nav>

        {authUser?.username ? (
          <div className="userMenuTopRight">
            <p className="usernameTopRight">{authUser.username}</p>
            <div className="userHoverMenu">
              <button
                onClick={() => {
                  navigate("/library");
                }}
              >
                View My Lists
              </button>
              <button onClick={logout}>Logout</button>
            </div>
          </div>
        ) : token && user?.display_name ? (
          <p className="usernameTopRight">{user.display_name}</p>
        ) : null}
      </div>

      <div className="body">
        <Routes>
          <Route path="/" element={renderHomePage()} />
          <Route path="/search" element={renderSearchPage()} />
          <Route path="/library" element={renderLibraryPage()} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Analytics />
      </div>
    </div>
  );
}

export default App;
