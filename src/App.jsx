import { useEffect, useMemo, useState } from "react";
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
  const [spotifyLinkError, setSpotifyLinkError] = useState("");

  const [search, setSearch] = useState("");
  const [searchType, setSearchType] = useState("album");
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [expandedAlbumId, setExpandedAlbumId] = useState(null);
  const [albumDetailsById, setAlbumDetailsById] = useState({});

  const [userLists, setUserLists] = useState([]);
  const [activeListId, setActiveListId] = useState(null);
  const [addToListOpenFor, setAddToListOpenFor] = useState(null);
  const [listMenuOpenId, setListMenuOpenId] = useState(null);

  const [albumMetaById, setAlbumMetaById] = useState({});
  const [albumRatings, setAlbumRatings] = useState({});
  const [ratingEntries, setRatingEntries] = useState([]);

  const canUseApp = Boolean(authToken && linkedSpotifyUserId);

  const activeList = useMemo(
    () => userLists.find((list) => list.id === activeListId) || null,
    [activeListId, userLists]
  );

  function getAuthHeaders() {
    if (!authToken) return {};
    return { Authorization: `Bearer ${authToken}` };
  }

  function clearAuthState() {
    setAuthToken("");
    setAuthUser(null);
    setLinkedSpotifyUserId(null);
    setAlbumMetaById({});
    setAlbumRatings({});
    setRatingEntries([]);
    setUserLists([]);
    setActiveListId(null);
    setResults([]);
    localStorage.removeItem("app_auth_token");
    localStorage.removeItem("app_auth_user");
    localStorage.removeItem("linked_spotify_user_id");
    localStorage.removeItem("spotify_verifier");
  }

  function logout() {
    clearAuthState();
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
    setSpotifyLinkError("");
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
      show_dialog: "true",
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

  async function getSpotifyAccessToken() {
    if (!authToken) return null;

    try {
      const response = await fetch(`${apiBaseURL}/api/spotify/token`, {
        headers: {
          ...getAuthHeaders(),
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.access_token || null;
    } catch {
      return null;
    }
  }

  async function spotifyApiFetch(path) {
    const accessToken = await getSpotifyAccessToken();
    if (!accessToken) return null;

    return fetch(`https://api.spotify.com/v1${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

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
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code || !authToken) return;

    const verifier = localStorage.getItem("spotify_verifier");
    if (!verifier) {
      setSpotifyLinkError("Missing Spotify verifier. Please click Link Spotify Account again.");
      return;
    }

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
      .then(async (tokenData) => {
        if (tokenData.error) {
          throw new Error(tokenData.error_description || tokenData.error);
        }

        if (!tokenData.access_token) {
          throw new Error("Spotify link failed");
        }

        async function fetchSpotifyProfile(accessToken) {
          const meResponse = await fetch("https://api.spotify.com/v1/me", {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (meResponse.ok) {
            return meResponse.json();
          }

          let errorMessage = `Spotify profile request failed (${meResponse.status})`;
          try {
            const errorData = await meResponse.json();
            errorMessage = errorData?.error?.message || errorData?.error || errorMessage;
          } catch {
            // no-op
          }

          throw new Error(errorMessage);
        }

        let spotifyProfile;
        let accessTokenForProfile = tokenData.access_token;

        try {
          spotifyProfile = await fetchSpotifyProfile(accessTokenForProfile);
        } catch (profileError) {
          // If the initial access token fails, try one refresh and retry /me once.
          if (!tokenData.refresh_token) {
            throw profileError;
          }

          const refreshResponse = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              client_id: clientID,
              grant_type: "refresh_token",
              refresh_token: tokenData.refresh_token,
            }),
          });

          const refreshData = await refreshResponse.json();
          if (!refreshResponse.ok || !refreshData.access_token) {
            throw profileError;
          }

          accessTokenForProfile = refreshData.access_token;
          spotifyProfile = await fetchSpotifyProfile(accessTokenForProfile);
        }

        const linkResponse = await fetch(`${apiBaseURL}/api/users/upsert`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            spotify_id: spotifyProfile.id,
            display_name: spotifyProfile.display_name,
            email: spotifyProfile.email,
            spotify_refresh_token: tokenData.refresh_token || null,
          }),
        });

        if (!linkResponse.ok) {
          const errorData = await linkResponse.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to link Spotify account");
        }

        const linkedData = await linkResponse.json();
        const spotifyUserId = linkedData.spotify_user_id;

        setLinkedSpotifyUserId(spotifyUserId);
        localStorage.setItem("linked_spotify_user_id", String(spotifyUserId));

        setAuthUser((prev) => {
          const next = { ...(prev || {}), spotify_user_id: spotifyUserId };
          localStorage.setItem("app_auth_user", JSON.stringify(next));
          return next;
        });

        window.history.replaceState({}, document.title, location.pathname);
      })
      .catch((error) => {
        console.error(error);
        setSpotifyLinkError(`Could not link Spotify: ${error.message}`);
      });
  }, [authToken, apiBaseURL, location.pathname]);

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

        const normalizedLists = (listsData || []).map((list) => ({
          ...list,
          items: (list.items || []).map((item) => ({
            id: item.id,
            item_type: item.item_type,
            item_id: item.item_id,
            item_name: item.item_name,
            item_subtitle: item.item_subtitle,
            image_url: item.image_url,
            position: item.position,
          })),
        }));

        setUserLists(normalizedLists);
        setActiveListId(null);
      })
      .catch((error) => {
        console.error("Failed to hydrate user data", error);
      });
  }, [apiBaseURL, authToken, linkedSpotifyUserId]);

  async function renameList(listId) {
    const list = userLists.find((entry) => entry.id === listId);
    const rawName = window.prompt("Rename list", list?.name || "");
    const name = rawName?.trim();

    if (!name) return;

    const response = await fetch(`${apiBaseURL}/api/lists/${listId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) return;

    const updated = await response.json();
    setUserLists((prev) =>
      prev
        .map((entry) => (entry.id === listId ? { ...entry, name: updated.name, updated_at: updated.updated_at } : entry))
        .sort(
          (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
        )
    );
  }

  async function deleteList(listId) {
    const shouldDelete = window.confirm("Delete this list?");
    if (!shouldDelete) return;

    const response = await fetch(`${apiBaseURL}/api/lists/${listId}`, {
      method: "DELETE",
      headers: {
        ...getAuthHeaders(),
      },
    });

    if (!response.ok) return;

    setUserLists((prev) => prev.filter((entry) => entry.id !== listId));
    setListMenuOpenId(null);
    if (activeListId === listId) {
      setActiveListId(null);
    }
  }

  useEffect(() => {
    if (!canUseApp || ratingEntries.length === 0) return;

    const albumIdsToLoad = [...new Set(ratingEntries.map((entry) => entry.album_id))].filter(
      (albumId) => albumId && !albumMetaById[albumId]
    );

    if (albumIdsToLoad.length === 0) return;

    const batchIds = albumIdsToLoad.slice(0, 20).join(",");

    spotifyApiFetch(`/albums?ids=${encodeURIComponent(batchIds)}`)
      .then(async (response) => {
        if (!response || !response.ok) {
          return;
        }

        const data = await response.json();
        setAlbumMetaById((prev) => {
          const next = { ...prev };
          (data.albums || []).forEach((album) => {
            if (!album?.id) return;
            next[album.id] = {
              name: album.name || "Unknown Album",
              artists: album.artists?.map((artist) => artist.name).join(", ") || "Unknown Artist",
            };
          });
          return next;
        });
      })
      .catch(() => {});
  }, [canUseApp, ratingEntries, albumMetaById]);

  function buildItemPayload(item) {
    if (searchType === "artist") {
      return {
        item_type: "artist",
        item_id: item.id,
        item_name: item.name,
        item_subtitle: "Artist",
        image_url: item.images?.[0]?.url || null,
      };
    }

    if (searchType === "track") {
      return {
        item_type: "track",
        item_id: item.id,
        item_name: item.name,
        item_subtitle: item.artists?.map((artist) => artist.name).join(", ") || "",
        image_url: item.album?.images?.[0]?.url || null,
      };
    }

    return {
      item_type: "album",
      item_id: item.id,
      item_name: item.name,
      item_subtitle: item.artists?.map((artist) => artist.name).join(", ") || "",
      image_url: item.images?.[0]?.url || null,
    };
  }

  async function createNewList() {
    const rawName = window.prompt("Name your new list");
    const name = rawName?.trim();

    if (!name) return null;

    const response = await fetch(`${apiBaseURL}/api/lists`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      return null;
    }

    const list = await response.json();
    const normalizedList = { ...list, items: [] };

    setUserLists((prev) =>
      [...prev, normalizedList].sort(
        (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
      )
    );

    return normalizedList;
  }

  async function addItemToList(listId, item) {
    if (!canUseApp) return;

    const payload = buildItemPayload(item);

    const response = await fetch(`${apiBaseURL}/api/lists/${listId}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return;
    }

    const savedItem = await response.json();

    setUserLists((prev) =>
      prev.map((list) => {
        if (list.id !== listId) return list;

        const exists = (list.items || []).some(
          (entry) => entry.item_type === savedItem.item_type && entry.item_id === savedItem.item_id
        );

        if (exists) {
          return {
            ...list,
            items: list.items.map((entry) =>
              entry.item_type === savedItem.item_type && entry.item_id === savedItem.item_id
                ? { ...entry, ...savedItem }
                : entry
            ),
          };
        }

        return {
          ...list,
          updated_at: new Date().toISOString(),
          items: [...(list.items || []), savedItem],
        };
      }).sort(
        (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
      )
    );

    setAddToListOpenFor(null);
  }

  async function reorderListItems(listId, orderedItemIds) {
    const response = await fetch(`${apiBaseURL}/api/lists/${listId}/items/reorder`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ ordered_item_ids: orderedItemIds }),
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();

    setUserLists((prev) =>
      prev
        .map((list) =>
          list.id === listId
            ? { ...list, items: data.items || [], updated_at: new Date().toISOString() }
            : list
        )
        .sort(
          (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
        )
    );
  }

  async function moveListItem(listId, itemId, direction) {
    const list = userLists.find((entry) => entry.id === listId);
    if (!list) return;

    const sortedItems = [...(list.items || [])].sort(
      (a, b) => (a.position || 0) - (b.position || 0)
    );

    const index = sortedItems.findIndex((entry) => entry.id === itemId);
    if (index < 0) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sortedItems.length) return;

    [sortedItems[index], sortedItems[targetIndex]] = [sortedItems[targetIndex], sortedItems[index]];

    const rePositioned = sortedItems.map((entry, positionIndex) => ({
      ...entry,
      position: positionIndex + 1,
    }));

    setUserLists((prev) =>
      prev.map((entry) => (entry.id === listId ? { ...entry, items: rePositioned } : entry))
    );

    void reorderListItems(
      listId,
      rePositioned.map((entry) => entry.id)
    );
  }

  async function searchSpotify() {
    if (!search.trim() || !canUseApp) return;

    setSearchLoading(true);
    setSearchError("");

    try {
      const response = await spotifyApiFetch(
        `/search?q=${encodeURIComponent(search)}&type=${searchType}`
      );

      if (!response) {
        setSearchError("Spotify session unavailable. Re-link Spotify from the user menu.");
        return;
      }

      if (!response.ok) {
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

    spotifyApiFetch(`/albums/${albumId}`)
      .then(async (res) => {
        if (!res || !res.ok) {
          setAlbumDetailsById((prev) => ({
            ...prev,
            [albumId]: { loading: false, tracks: [], releaseDate: "" },
          }));
          return;
        }

        const data = await res.json();
        setAlbumDetailsById((prev) => ({
          ...prev,
          [albumId]: {
            loading: false,
            tracks: data.tracks?.items || [],
            releaseDate: data.release_date || "",
          },
        }));
      })
      .catch(() => {
        setAlbumDetailsById((prev) => ({
          ...prev,
          [albumId]: { loading: false, tracks: [], releaseDate: "" },
        }));
      });
  }

  async function rateAlbum(albumId) {
    if (!canUseApp) return;

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

  function renderAddToListMenu(item) {
    const menuKey = `${searchType}:${item.id}`;

    return (
      <div className="addListMenuWrap">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAddToListOpenFor((prev) => (prev === menuKey ? null : menuKey));
          }}
        >
          Add to List
        </button>

        {addToListOpenFor === menuKey ? (
          <div className="addListDropdown" onClick={(e) => e.stopPropagation()}>
            {userLists.length === 0 ? <p className="dropdownEmpty">No lists yet.</p> : null}
            {userLists.map((list, index) => (
              <button
                key={list.id}
                type="button"
                onClick={() => {
                  void addItemToList(list.id, item);
                }}
              >
                {index + 1}. {list.name}
              </button>
            ))}
            <button
              type="button"
              onClick={async () => {
                const newList = await createNewList();
                if (!newList) return;
                await addItemToList(newList.id, item);
              }}
            >
              + New List
            </button>
          </div>
        ) : null}
      </div>
    );
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
        {spotifyLinkError ? <p className="authError">{spotifyLinkError}</p> : null}
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

                <div className="resultActions">{renderAddToListMenu(item)}</div>

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

    const sortedLists = [...userLists].sort((a, b) => a.id - b.id);

    return (
      <div className="libraryPage">
        <h2 className="pageTitle">Library / Profile</h2>

        <div className="listPreviewGrid">
          {sortedLists.map((list, index) => {
            const previewItems = [...(list.items || [])]
              .sort((a, b) => (a.position || 0) - (b.position || 0))
              .slice(0, 4);

            return (
              <button
                type="button"
                key={list.id}
                className={`listPreviewCard ${activeListId === list.id ? "active" : ""}`}
                onClick={() => setActiveListId(list.id)}
              >
                <div className="listPreviewHeader">
                  <p className="listPreviewTitle">{list.name}</p>
                  <div className="listCardMenuWrap">
                    <button
                      type="button"
                      className="listCardMenuButton"
                      onClick={(event) => {
                        event.stopPropagation();
                        setListMenuOpenId(list.id);
                      }}
                    >
                      ⋮
                    </button>
                    {listMenuOpenId === list.id ? (
                      <div className="listCardMenu" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveListId(list.id);
                            setListMenuOpenId(null);
                          }}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void renameList(list.id);
                            setListMenuOpenId(null);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void deleteList(list.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="listPreviewImages">
                  {[0, 1, 2, 3].map((slot) => {
                    const previewItem = previewItems[slot];
                    return previewItem?.image_url ? (
                      <img key={slot} src={previewItem.image_url} alt={previewItem.item_name} />
                    ) : (
                      <div key={slot} className="previewPlaceholder" />
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>

        {activeList ? (
          <div className="myListsPanel">
            <div className="selectedListHeader">
              <h3>{activeList.name}</h3>
              <button type="button" onClick={() => setActiveListId(null)}>
                Close
              </button>
            </div>
            {(activeList.items || []).length === 0 ? (
              <p>No items in this list yet.</p>
            ) : (
              <div className="myListItems">
                {[...(activeList.items || [])]
                  .sort((a, b) => (a.position || 0) - (b.position || 0))
                  .map((item, index) => (
                    <div key={item.id} className="myListItem listRow">
                      <p>
                        {index + 1}. {item.item_name}
                      </p>
                      <p>{item.item_subtitle}</p>
                      <div className="listReorderActions">
                        <button type="button" onClick={() => void moveListItem(activeList.id, item.id, "up")}>
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveListItem(activeList.id, item.id, "down")}
                        >
                          Down
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="myListsPanel">
          <h3>My Reviews</h3>
          {ratingEntries.length === 0 ? (
            <p>No ratings yet.</p>
          ) : (
            <div className="myListItems">
              {ratingEntries.map((entry) => (
                <div key={`${entry.album_id}-${entry.rating}`} className="myListItem">
                  <p>{albumMetaById[entry.album_id]?.name || "Loading album..."}</p>
                  <p>{albumMetaById[entry.album_id]?.artists || "Loading artist..."}</p>
                  <p>Rating: {entry.rating}/10</p>
                </div>
              ))}
            </div>
          )}
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

    if (!linkedSpotifyUserId) {
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
              <button onClick={loginSpotify}>Re-link Spotify</button>
              <button onClick={logout}>Logout</button>
            </div>
          </div>
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
