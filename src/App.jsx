import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import SearchPage from "./search";
import LibraryPage from "./library";
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

  const [userLists, setUserLists] = useState([]);
  const [reviewByKey, setReviewByKey] = useState({});
  const [reviewEntries, setReviewEntries] = useState([]);

  const canUseApp = Boolean(authToken && linkedSpotifyUserId);

  function getAuthHeaders() {
    if (!authToken) return {};
    return { Authorization: `Bearer ${authToken}` };
  }

  function clearAuthState() {
    setAuthToken("");
    setAuthUser(null);
    setLinkedSpotifyUserId(null);
    setReviewByKey({});
    setReviewEntries([]);
    setUserLists([]);
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
        setReviewEntries(ratingsData);

        const reviewMap = ratingsData.reduce((acc, ratingRow) => {
          const itemType = ratingRow.item_type || "album";
          const itemId = ratingRow.item_id || ratingRow.album_id;
          if (!itemId) return acc;
          acc[`${itemType}:${itemId}`] = ratingRow;
          return acc;
        }, {});
        setReviewByKey(reviewMap);

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
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
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

  async function addItemToList(listId, payload) {
    if (!canUseApp) return;

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
      prev
        .map((list) => {
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
        })
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    );
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
          list.id === listId ? { ...list, items: data.items || [], updated_at: new Date().toISOString() } : list
        )
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    );
  }

  async function removeItemFromList(listId, listItemId) {
    const response = await fetch(`${apiBaseURL}/api/lists/${listId}/items/${listItemId}`, {
      method: "DELETE",
      headers: {
        ...getAuthHeaders(),
      },
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();

    setUserLists((prev) =>
      prev
        .map((list) =>
          list.id === listId ? { ...list, items: data.items || [], updated_at: new Date().toISOString() } : list
        )
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    );
  }

  async function saveReview(payload) {
    if (!canUseApp) return;

    const response = await fetch(`${apiBaseURL}/api/ratings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return;

    const savedReview = await response.json();
    const itemType = savedReview.item_type || "album";
    const itemId = savedReview.item_id || savedReview.album_id;
    if (!itemId) return;
    const reviewKey = `${itemType}:${itemId}`;

    setReviewByKey((prev) => ({
      ...prev,
      [reviewKey]: savedReview,
    }));

    setReviewEntries((prev) => {
      const rest = prev.filter((entry) => {
        const entryType = entry.item_type || "album";
        const entryId = entry.item_id || entry.album_id;
        return `${entryType}:${entryId}` !== reviewKey;
      });
      return [savedReview, ...rest];
    });
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
          <Link className={location.pathname === "/search" ? "navLink active" : "navLink"} to="/search">
            Search
          </Link>
          <Link className={location.pathname === "/library" ? "navLink active" : "navLink"} to="/library">
            Library
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
          <Route
            path="/search"
            element={
              <SearchPage
                canUseApp={canUseApp}
                spotifyApiFetch={spotifyApiFetch}
                userLists={userLists}
                createNewList={createNewList}
                addItemToList={addItemToList}
                saveReview={saveReview}
                reviewByKey={reviewByKey}
              />
            }
          />
          <Route
            path="/library"
            element={
              <LibraryPage
                canUseApp={canUseApp}
                userLists={userLists}
                setUserLists={setUserLists}
                renameList={renameList}
                deleteList={deleteList}
                reorderListItems={reorderListItems}
                removeItemFromList={removeItemFromList}
                reviewEntries={reviewEntries}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Analytics />
        <SpeedInsights />
      </div>
    </div>
  );
}

export default App;
