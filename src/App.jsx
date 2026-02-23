import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import SearchPage from "./search";
import LibraryPage from "./library";
import "./App.css";

function App() {
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
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [authError, setAuthError] = useState("");

  const [userLists, setUserLists] = useState([]);
  const [reviewByKey, setReviewByKey] = useState({});
  const [reviewEntries, setReviewEntries] = useState([]);
  const spotifyTokenCacheRef = useRef({ accessToken: "", expiresAtMs: 0 });

  const canUseApp = Boolean(authToken);

  function withAuthHeaders(headers = {}) {
    if (!authToken) return headers;
    return { ...headers, Authorization: `Bearer ${authToken}` };
  }

  function sortListsByRecency(lists) {
    return [...lists].sort(
      (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
    );
  }

  function clearAuthState() {
    setAuthToken("");
    setAuthUser(null);
    setReviewByKey({});
    setReviewEntries([]);
    setUserLists([]);
    spotifyTokenCacheRef.current = { accessToken: "", expiresAtMs: 0 };
    localStorage.removeItem("app_auth_token");
    localStorage.removeItem("app_auth_user");
  }

  function logout() {
    clearAuthState();
    navigate("/");
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
      localStorage.setItem("app_auth_token", data.token);
      localStorage.setItem("app_auth_user", JSON.stringify(data.user));

      navigate("/");
    } catch (error) {
      setAuthError("Authentication request failed");
      console.error(error);
    }
  }

  async function getSpotifyAccessToken() {
    if (!authToken) return null;
    const cached = spotifyTokenCacheRef.current;
    if (cached.accessToken && Date.now() < cached.expiresAtMs - 30_000) {
      return cached.accessToken;
    }

    try {
      const response = await fetch(`${apiBaseURL}/api/spotify/token`, {
        headers: withAuthHeaders(),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data.access_token) {
        return null;
      }

      const expiresInSeconds = Number(data.expires_in || 3600);
      spotifyTokenCacheRef.current = {
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
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status !== 401) {
      return response;
    }

    // Clear cache and retry once if Spotify token has expired unexpectedly.
    spotifyTokenCacheRef.current = { accessToken: "", expiresAtMs: 0 };
    const nextToken = await getSpotifyAccessToken();
    if (!nextToken) return null;

    response = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: {
        Authorization: `Bearer ${nextToken}`,
      },
    });

    return response;
  }

  useEffect(() => {
    if (!authToken) return;

    fetch(`${apiBaseURL}/api/auth/me`, {
      headers: withAuthHeaders(),
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Invalid auth session");
        }
        return res.json();
      })
      .then((data) => {
        setAuthUser(data);
        localStorage.setItem("app_auth_user", JSON.stringify(data));
      })
      .catch(() => {
        clearAuthState();
      });
  }, [apiBaseURL, authToken]);

  useEffect(() => {
    if (!authToken) return;

    Promise.all([
      fetch(`${apiBaseURL}/api/ratings`, {
        headers: withAuthHeaders(),
      }),
      fetch(`${apiBaseURL}/api/lists`, {
        headers: withAuthHeaders(),
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

        setUserLists(sortListsByRecency(normalizedLists));
      })
      .catch((error) => {
        console.error("Failed to hydrate user data", error);
      });
  }, [apiBaseURL, authToken]);

  async function renameList(listId) {
    const list = userLists.find((entry) => entry.id === listId);
    const rawName = window.prompt("Rename list", list?.name || "");
    const name = rawName?.trim();

    if (!name) return;

    const response = await fetch(`${apiBaseURL}/api/lists/${listId}`, {
      method: "PATCH",
      headers: {
        ...withAuthHeaders({ "Content-Type": "application/json" }),
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) return;

    const updated = await response.json();
    setUserLists((prev) =>
      sortListsByRecency(
        prev.map((entry) => (entry.id === listId ? { ...entry, name: updated.name, updated_at: updated.updated_at } : entry))
      )
    );
  }

  async function deleteList(listId) {
    const shouldDelete = window.confirm("Delete this list?");
    if (!shouldDelete) return;

    const response = await fetch(`${apiBaseURL}/api/lists/${listId}`, {
      method: "DELETE",
      headers: withAuthHeaders(),
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
        ...withAuthHeaders({ "Content-Type": "application/json" }),
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      return null;
    }

    const list = await response.json();
    const normalizedList = { ...list, items: [] };

    setUserLists((prev) => sortListsByRecency([...prev, normalizedList]));

    return normalizedList;
  }

  async function addItemToList(listId, payload) {
    if (!canUseApp) return;

    const response = await fetch(`${apiBaseURL}/api/lists/${listId}/items`, {
      method: "POST",
      headers: {
        ...withAuthHeaders({ "Content-Type": "application/json" }),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return;
    }

    const savedItem = await response.json();

    setUserLists((prev) =>
      sortListsByRecency(
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
        })
      )
    );
  }

  async function reorderListItems(listId, orderedItemIds) {
    const response = await fetch(`${apiBaseURL}/api/lists/${listId}/items/reorder`, {
      method: "PATCH",
      headers: withAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ordered_item_ids: orderedItemIds }),
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();

    setUserLists((prev) =>
      sortListsByRecency(
        prev.map((list) =>
          list.id === listId ? { ...list, items: data.items || [], updated_at: new Date().toISOString() } : list
        )
      )
    );
  }

  async function removeItemFromList(listId, listItemId) {
    const response = await fetch(`${apiBaseURL}/api/lists/${listId}/items/${listItemId}`, {
      method: "DELETE",
      headers: withAuthHeaders(),
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();

    setUserLists((prev) =>
      sortListsByRecency(
        prev.map((list) =>
          list.id === listId ? { ...list, items: data.items || [], updated_at: new Date().toISOString() } : list
        )
      )
    );
  }

  async function saveReview(payload) {
    if (!canUseApp) return;

    const response = await fetch(`${apiBaseURL}/api/ratings`, {
      method: "POST",
      headers: withAuthHeaders({ "Content-Type": "application/json" }),
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
