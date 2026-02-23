import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import SearchPage from "./search";
import LibraryPage from "./library";
import AlbumPage from "./album";
import UserPage from "./user";
import ChartsPage from "./charts";
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
  const [authForm, setAuthForm] = useState({ username: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");

  const [userLists, setUserLists] = useState([]);
  const [reviewByKey, setReviewByKey] = useState({});
  const [reviewEntries, setReviewEntries] = useState([]);
  const [listenLaterItems, setListenLaterItems] = useState([]);
  const [feedEntries, setFeedEntries] = useState([]);
  const [reviewEditor, setReviewEditor] = useState({ open: false, payload: null });
  const [reviewDraft, setReviewDraft] = useState({ rating: 0, title: "", body: "" });
  const [reviewEditorError, setReviewEditorError] = useState("");
  const [reviewEditorSaving, setReviewEditorSaving] = useState(false);
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
    setListenLaterItems([]);
    setFeedEntries([]);
    setReviewEditor({ open: false, payload: null });
    setReviewDraft({ rating: 0, title: "", body: "" });
    setReviewEditorError("");
    setReviewEditorSaving(false);
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
      fetch(`${apiBaseURL}/api/listen-later`, {
        headers: withAuthHeaders(),
      }),
      fetch(`${apiBaseURL}/api/feed?limit=40`, {
        headers: withAuthHeaders(),
      }),
    ])
      .then(async ([ratingsRes, listsRes, listenLaterRes, feedRes]) => {
        const ratingsData = ratingsRes.ok ? await ratingsRes.json() : [];
        const listsData = listsRes.ok ? await listsRes.json() : [];
        const listenLaterData = listenLaterRes.ok ? await listenLaterRes.json() : [];
        const feedData = feedRes.ok ? await feedRes.json() : [];
        return { ratingsData, listsData, listenLaterData, feedData };
      })
      .then(({ ratingsData, listsData, listenLaterData, feedData }) => {
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
        setListenLaterItems(listenLaterData);
        setFeedEntries(feedData);
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
    if (!canUseApp) return false;

    try {
      const response = await fetch(`${apiBaseURL}/api/ratings`, {
        method: "POST",
        headers: withAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      if (!response.ok) return false;

      const savedReview = await response.json();
      const itemType = savedReview.item_type || "album";
      const itemId = savedReview.item_id || savedReview.album_id;
      if (!itemId) return false;
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

      setListenLaterItems((prev) =>
        prev.filter((entry) => `${entry.item_type}:${entry.item_id}` !== reviewKey)
      );

      setFeedEntries((prev) => {
        const existingIndex = prev.findIndex((entry) => entry.id === savedReview.id);
        if (existingIndex === -1) {
          return prev;
        }
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          ...savedReview,
          updated_at: savedReview.updated_at,
          review_title: savedReview.review_title,
          review_body: savedReview.review_body,
          rating: savedReview.rating,
        };
        return next;
      });

      return true;
    } catch {
      return false;
    }
  }

  function openReviewEditor(payload) {
    if (!payload?.item_type || !payload?.item_id) return;
    const reviewKey = `${payload.item_type}:${payload.item_id}`;
    const existing = reviewByKey[reviewKey];

    setReviewDraft({
      rating: existing?.rating || 0,
      title: existing?.review_title || "",
      body: existing?.review_body || "",
    });
    setReviewEditorError("");
    setReviewEditor({ open: true, payload });
  }

  function closeReviewEditor() {
    if (reviewEditorSaving) return;
    setReviewEditor({ open: false, payload: null });
    setReviewDraft({ rating: 0, title: "", body: "" });
    setReviewEditorError("");
  }

  async function submitReviewEditor() {
    if (!reviewEditor.payload) return;
    if (!reviewDraft.rating || reviewDraft.rating < 1 || reviewDraft.rating > 10) {
      setReviewEditorError("Choose a rating from 1 to 10.");
      return;
    }

    setReviewEditorSaving(true);
    setReviewEditorError("");

    const didSave = await saveReview({
      ...reviewEditor.payload,
      rating: reviewDraft.rating,
      review_title: reviewDraft.title.trim() || null,
      review_body: reviewDraft.body.trim() || null,
    });

    setReviewEditorSaving(false);

    if (!didSave) {
      setReviewEditorError("Could not save review. Please try again.");
      return;
    }

    setReviewEditor({ open: false, payload: null });
    setReviewDraft({ rating: 0, title: "", body: "" });
    setReviewEditorError("");
  }

  async function addToListenLater(payload) {
    if (!canUseApp) return;
    if (!["album", "track"].includes(payload?.item_type)) return;

    const response = await fetch(`${apiBaseURL}/api/listen-later`, {
      method: "POST",
      headers: withAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    if (!response.ok) return;

    const saved = await response.json();
    setListenLaterItems((prev) => {
      const rest = prev.filter(
        (entry) => !(entry.item_type === saved.item_type && entry.item_id === saved.item_id)
      );
      return [saved, ...rest];
    });
  }

  async function removeListenLaterItem(itemRowId) {
    const response = await fetch(`${apiBaseURL}/api/listen-later/${itemRowId}`, {
      method: "DELETE",
      headers: withAuthHeaders(),
    });

    if (!response.ok) return;
    setListenLaterItems((prev) => prev.filter((entry) => entry.id !== itemRowId));
  }

  async function getAverageRating(itemType, itemId) {
    const response = await fetch(
      `${apiBaseURL}/api/ratings/average?item_type=${encodeURIComponent(itemType)}&item_id=${encodeURIComponent(itemId)}`,
      {
        headers: withAuthHeaders(),
      }
    );

    if (!response.ok) return null;
    return response.json();
  }

  async function getCharts(itemType, limit = 50) {
    const response = await fetch(
      `${apiBaseURL}/api/charts?item_type=${encodeURIComponent(itemType)}&limit=${encodeURIComponent(limit)}`,
      {
        headers: withAuthHeaders(),
      }
    );
    if (!response.ok) return [];
    return response.json();
  }

  async function searchUsers(query) {
    const response = await fetch(`${apiBaseURL}/api/users/search?q=${encodeURIComponent(query)}`, {
      headers: withAuthHeaders(),
    });
    if (!response.ok) return [];
    return response.json();
  }

  async function getUserProfile(username) {
    const response = await fetch(`${apiBaseURL}/api/users/${encodeURIComponent(username)}/profile`, {
      headers: withAuthHeaders(),
    });
    if (!response.ok) return null;
    return response.json();
  }

  async function toggleFeedLike(reviewId, currentlyLiked) {
    const response = await fetch(`${apiBaseURL}/api/feed/reviews/${reviewId}/like`, {
      method: currentlyLiked ? "DELETE" : "POST",
      headers: withAuthHeaders(),
    });
    if (!response.ok) return;

    const data = await response.json();
    setFeedEntries((prev) =>
      prev.map((entry) =>
        entry.id === reviewId
          ? {
              ...entry,
              like_count: data.like_count,
              liked_by_me: data.liked_by_me,
            }
          : entry
      )
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
        {authMode === "register" ? (
          <input
            type="email"
            value={authForm.email}
            onChange={(e) =>
              setAuthForm((prev) => ({
                ...prev,
                email: e.target.value,
              }))
            }
            placeholder="Email"
          />
        ) : null}
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
        <div className="feedList">
          {feedEntries.length === 0 ? <p>No reviews yet.</p> : null}
          {feedEntries.map((entry) => (
            <div key={entry.id} className="feedCard">
              {entry.image_url ? (
                <img src={entry.image_url} alt={entry.item_name || "Reviewed item"} className="feedImage" />
              ) : (
                <div className="feedImage placeholder" />
              )}
                <div className="feedBody">
                  <div className="feedHeaderRow">
                    <Link className="feedUsername" to={`/user/${entry.username}`}>
                      {entry.username}
                    </Link>
                    <div className="feedHeaderRight">
                      <p className="feedRating">{entry.rating}/10</p>
                      <button
                        type="button"
                        className={`feedLikeButton ${entry.liked_by_me ? "active" : ""}`}
                        onClick={() => {
                          void toggleFeedLike(entry.id, Boolean(entry.liked_by_me));
                        }}
                        aria-label="Like review"
                      >
                        <span className="feedLikeIcon">{entry.liked_by_me ? "♥" : "♡"}</span>
                        <span>{entry.like_count || 0}</span>
                      </button>
                    </div>
                  </div>
                  <p className="feedItemName">{entry.item_name || "Unknown Item"}</p>
                  <p>{entry.item_subtitle || ""}</p>
                  {entry.review_title ? <p className="feedReviewTitle">{entry.review_title}</p> : null}
                  {entry.review_body ? <p className="feedReviewBody">{entry.review_body}</p> : null}
                </div>
              </div>
            ))}
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
          <Link className={location.pathname === "/charts" ? "navLink active" : "navLink"} to="/charts">
            Charts
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
                addToListenLater={addToListenLater}
                listenLaterItems={listenLaterItems}
                reviewByKey={reviewByKey}
                openReviewEditor={openReviewEditor}
                searchUsers={searchUsers}
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
                listenLaterItems={listenLaterItems}
                removeListenLaterItem={removeListenLaterItem}
              />
            }
          />
          <Route
            path="/charts"
            element={
              <ChartsPage
                canUseApp={canUseApp}
                getCharts={getCharts}
              />
            }
          />
          <Route
            path="/album/:albumId"
            element={
              <AlbumPage
                canUseApp={canUseApp}
                spotifyApiFetch={spotifyApiFetch}
                userLists={userLists}
                createNewList={createNewList}
                addItemToList={addItemToList}
                addToListenLater={addToListenLater}
                listenLaterItems={listenLaterItems}
                reviewByKey={reviewByKey}
                openReviewEditor={openReviewEditor}
                getAverageRating={getAverageRating}
              />
            }
          />
          <Route
            path="/user/:username"
            element={
              <UserPage
                canUseApp={canUseApp}
                getUserProfile={getUserProfile}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {reviewEditor.open ? (
          <div
            className="reviewModalBackdrop"
            onClick={() => {
              closeReviewEditor();
            }}
          >
            <div
              className="reviewModalCard"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <h3>Review</h3>
              <div className="reviewDotsRow">
                {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                  <button
                    key={score}
                    type="button"
                    className={`reviewDot ${reviewDraft.rating >= score ? "active" : ""}`}
                    onClick={() => {
                      setReviewDraft((prev) => ({ ...prev, rating: score }));
                      setReviewEditorError("");
                    }}
                    aria-label={`Rate ${score} out of 10`}
                  />
                ))}
              </div>
              <input
                type="text"
                className="reviewInput"
                placeholder="Review title (optional)"
                value={reviewDraft.title}
                onChange={(event) => {
                  setReviewDraft((prev) => ({ ...prev, title: event.target.value }));
                }}
              />
              <textarea
                className="reviewTextarea"
                placeholder="Review text (optional)"
                value={reviewDraft.body}
                onChange={(event) => {
                  setReviewDraft((prev) => ({ ...prev, body: event.target.value }));
                }}
              />
              {reviewEditorError ? <p className="authError">{reviewEditorError}</p> : null}
              <div className="reviewModalActions">
                <button
                  type="button"
                  onClick={() => {
                    void submitReviewEditor();
                  }}
                  disabled={reviewEditorSaving}
                >
                  {reviewEditorSaving ? "Saving..." : "Save"}
                </button>
                <button type="button" onClick={closeReviewEditor} disabled={reviewEditorSaving}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <Analytics />
        <SpeedInsights />
      </div>
    </div>
  );
}

export default App;
