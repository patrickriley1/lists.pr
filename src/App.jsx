import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import SearchPage from "./search";
import LibraryPage from "./library";
import AlbumPage from "./album";
import ArtistPage from "./artist";
import UserPage from "./user";
import ChartsPage from "./charts";
import SettingsPage from "./settings";
import ArtistLinks from "./artist-links";
import "./App.css";

function UserAvatar({ imageUrl, name, className }) {
  if (imageUrl) {
    return <img src={imageUrl} alt={name || "User"} className={className} />;
  }

  return <div className={`${className} placeholder`}>{name?.[0]?.toUpperCase() || "U"}</div>;
}

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
  const [publicLists, setPublicLists] = useState([]);
  const [expandedHomeListIds, setExpandedHomeListIds] = useState({});
  const [reviewEditor, setReviewEditor] = useState({ open: false, payload: null });
  const [reviewDraft, setReviewDraft] = useState({ rating: 0, title: "", body: "" });
  const [reviewEditorError, setReviewEditorError] = useState("");
  const [reviewEditorSaving, setReviewEditorSaving] = useState(false);
  const [reviewEditorDeleting, setReviewEditorDeleting] = useState(false);
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

  //This here handles the logout function (it clears all user data from the local storage)
  function clearAuthState() {
    setAuthToken("");
    setAuthUser(null);
    setReviewByKey({});
    setReviewEntries([]);
    setUserLists([]);
    setListenLaterItems([]);
    setFeedEntries([]);
    setPublicLists([]);
    setExpandedHomeListIds({});
    setReviewEditor({ open: false, payload: null });
    setReviewDraft({ rating: 0, title: "", body: "" });
    setReviewEditorError("");
    setReviewEditorSaving(false);
    setReviewEditorDeleting(false);
    spotifyTokenCacheRef.current = { accessToken: "", expiresAtMs: 0 };
    localStorage.removeItem("app_auth_token");
    localStorage.removeItem("app_auth_user");
  }

  //Calls the function above, navigates to the homepage
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
      fetch(`${apiBaseURL}/api/lists/discover?limit=24`, {
        headers: withAuthHeaders(),
      }),
    ])
      .then(async ([ratingsRes, listsRes, listenLaterRes, feedRes, publicListsRes]) => {
        const ratingsData = ratingsRes.ok ? await ratingsRes.json() : [];
        const listsData = listsRes.ok ? await listsRes.json() : [];
        const listenLaterData = listenLaterRes.ok ? await listenLaterRes.json() : [];
        const feedData = feedRes.ok ? await feedRes.json() : [];
        const publicListsData = publicListsRes.ok ? await publicListsRes.json() : [];
        return { ratingsData, listsData, listenLaterData, feedData, publicListsData };
      })
      .then(({ ratingsData, listsData, listenLaterData, feedData, publicListsData }) => {
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
        setPublicLists(publicListsData);
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
    if (reviewEditorSaving || reviewEditorDeleting) return;
    setReviewEditor({ open: false, payload: null });
    setReviewDraft({ rating: 0, title: "", body: "" });
    setReviewEditorError("");
    setReviewEditorDeleting(false);
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

  async function deleteReview(itemType, itemId) {
    const response = await fetch(
      `${apiBaseURL}/api/ratings?item_type=${encodeURIComponent(itemType)}&item_id=${encodeURIComponent(itemId)}`,
      {
        method: "DELETE",
        headers: withAuthHeaders(),
      }
    );

    if (!response.ok) {
      return false;
    }

    const reviewKey = `${itemType}:${itemId}`;

    setReviewByKey((prev) => {
      const next = { ...prev };
      delete next[reviewKey];
      return next;
    });
    setReviewEntries((prev) =>
      prev.filter((entry) => {
        const entryType = entry.item_type || "album";
        const entryId = entry.item_id || entry.album_id;
        return `${entryType}:${entryId}` !== reviewKey;
      })
    );
    setFeedEntries((prev) =>
      prev.filter((entry) => {
        const entryType = entry.item_type || "album";
        const entryId = entry.item_id || entry.album_id;
        return entry.app_user_id !== authUser?.id || `${entryType}:${entryId}` !== reviewKey;
      })
    );

    return true;
  }

  async function deleteReviewFromEditor() {
    const payload = reviewEditor.payload;
    if (!payload?.item_type || !payload?.item_id) return;
    const shouldDelete = window.confirm("Delete this review?");
    if (!shouldDelete) return;

    setReviewEditorDeleting(true);
    setReviewEditorError("");

    const didDelete = await deleteReview(payload.item_type, payload.item_id);

    setReviewEditorDeleting(false);

    if (!didDelete) {
      setReviewEditorError("Could not delete review. Please try again.");
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

  async function getRecentRatings(itemType, itemId, limit = 8) {
    const response = await fetch(
      `${apiBaseURL}/api/ratings/recent?item_type=${encodeURIComponent(itemType)}&item_id=${encodeURIComponent(itemId)}&limit=${encodeURIComponent(limit)}`,
      {
        headers: withAuthHeaders(),
      }
    );

    if (response.ok) {
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    }

    // Backward-compatible fallback when deployed API does not yet include /api/ratings/recent.
    const feedResponse = await fetch(`${apiBaseURL}/api/feed?limit=100`, {
      headers: withAuthHeaders(),
    });
    if (!feedResponse.ok) return [];

    const feedData = await feedResponse.json();
    if (!Array.isArray(feedData)) return [];

    return feedData
      .filter(
        (entry) =>
          String(entry?.item_type || "") === String(itemType) &&
          String(entry?.item_id || "") === String(itemId)
      )
      .slice(0, limit);
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

  async function submitCommunitySubmission(payload) {
    const response = await fetch(`${apiBaseURL}/api/community/submissions`, {
      method: "POST",
      headers: withAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    const rawBody = await response.text();
    let data = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = {};
      }
    }
    if (!response.ok) {
      const fallbackMessage =
        response.status === 404
          ? "Submission endpoint not found on the API. Deploy backend changes."
          : `Failed to submit (${response.status})`;
      throw new Error(data.error || fallbackMessage);
    }

    return data;
  }

  async function getUserProfile(username) {
    const response = await fetch(`${apiBaseURL}/api/users/${encodeURIComponent(username)}/profile`, {
      headers: withAuthHeaders(),
    });
    if (!response.ok) return null;
    return response.json();
  }

  async function updateCurrentUserProfile({ username, profileImageUrl }) {
    const response = await fetch(`${apiBaseURL}/api/auth/me`, {
      method: "PATCH",
      headers: withAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        username,
        profile_image_url: profileImageUrl || null,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Failed to update profile settings");
    }

    setAuthUser(data);
    localStorage.setItem("app_auth_user", JSON.stringify(data));

    setFeedEntries((prev) =>
      prev.map((entry) =>
        entry.app_user_id === data.id
          ? { ...entry, username: data.username, user_profile_image_url: data.profile_image_url || null }
          : entry
      )
    );

    setPublicLists((prev) =>
      prev.map((entry) =>
        entry.app_user_id === data.id
          ? { ...entry, username: data.username, user_profile_image_url: data.profile_image_url || null }
          : entry
      )
    );

    return data;
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

    const feedEntriesWithReviewText = (feedEntries || []).filter((entry) => {
      const hasTitle = typeof entry.review_title === "string" && entry.review_title.trim().length > 0;
      const hasBody = typeof entry.review_body === "string" && entry.review_body.trim().length > 0;
      return hasTitle && hasBody;
    });
    const combinedHomeFeed = [
      ...(publicLists || []).map((list) => ({
        activity_type: "list",
        sort_date: list.updated_at || list.created_at || null,
        ...list,
      })),
      ...feedEntriesWithReviewText.map((entry) => ({
        activity_type: "review",
        sort_date: entry.updated_at || entry.created_at || null,
        ...entry,
      })),
    ].sort((a, b) => new Date(b.sort_date || 0) - new Date(a.sort_date || 0));

    return (
      <div className="pageSection">
        <h2 className="pageTitle">Home</h2>
        <div className="feedList">
          {combinedHomeFeed.length === 0 ? <p>No activity yet.</p> : null}
          {combinedHomeFeed.map((entry) => {
            const isListEntry = entry.activity_type === "list";
            const listItems = isListEntry ? entry.items || [] : [];
            const isListExpanded = isListEntry ? Boolean(expandedHomeListIds[entry.id]) : false;
            const visibleListItems = isListEntry ? (isListExpanded ? listItems : listItems.slice(0, 8)) : [];

            return (
            <div key={`${entry.activity_type}:${entry.id}`} className="feedCard">
              {entry.activity_type === "review" ? (
                <>
                  {entry.image_url ? (
                    <img src={entry.image_url} alt={entry.item_name || "Reviewed item"} className="feedImage" />
                  ) : (
                    <div className="feedImage placeholder" />
                  )}
                  <div className="feedBody">
                    <div className="feedHeaderRow">
                      <div className="feedAuthor">
                        <UserAvatar
                          imageUrl={entry.user_profile_image_url}
                          name={entry.username}
                          className="feedUserAvatar"
                        />
                        <Link className="feedUsername" to={`/user/${entry.username}`}>
                          {entry.username}
                        </Link>
                      </div>
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
                    <p className="feedItemName">
                      {entry.item_type === "artist" ? (
                        <Link to={`/artist/${entry.item_id}`}>{entry.item_name || "Unknown Item"}</Link>
                      ) : entry.item_type === "album" ? (
                        <Link to={`/album/${entry.item_id}`}>{entry.item_name || "Unknown Item"}</Link>
                      ) : (
                        entry.item_name || "Unknown Item"
                      )}
                    </p>
                    <p>
                      {entry.item_type === "artist" ? entry.item_subtitle || "" : <ArtistLinks text={entry.item_subtitle || ""} />}
                    </p>
                    {entry.review_title ? <p className="feedReviewTitle">{entry.review_title}</p> : null}
                    {entry.review_body ? <p className="feedReviewBody">{entry.review_body}</p> : null}
                  </div>
                </>
              ) : (
                <div className="feedBody listFeedBody">
                  <div className="feedHeaderRow">
                    <div className="feedAuthor">
                      <UserAvatar
                        imageUrl={entry.user_profile_image_url}
                        name={entry.username}
                        className="feedUserAvatar"
                      />
                      <Link className="feedUsername" to={`/user/${entry.username}`}>
                        {entry.username}
                      </Link>
                    </div>
                    <p className="listFeedMeta">{Number(entry.item_count || 0)} items</p>
                  </div>
                  <p className="feedItemName">{entry.name || "Untitled List"}</p>
                  {!isListExpanded ? (
                    <div
                      className="listFeedPreview"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setExpandedHomeListIds((prev) => ({ ...prev, [entry.id]: true }));
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setExpandedHomeListIds((prev) => ({ ...prev, [entry.id]: true }));
                      }}
                    >
                      {visibleListItems.map((item, index) =>
                        item?.image_url ? (
                          <img
                            key={`${entry.id}-${item.item_name || "item"}-${index}`}
                            src={item.image_url}
                            alt={item.item_name || "List item"}
                          />
                        ) : (
                          <div key={`${entry.id}-placeholder-${index}`} className="listFeedPreviewPlaceholder" />
                        )
                      )}
                    </div>
                  ) : (
                    <div className="homeListExpandedGrid">
                      {listItems.map((item, index) => (
                        <div key={`${entry.id}-expanded-${item.item_name || "item"}-${index}`} className="homeListExpandedItem">
                          <span className="homeListExpandedPosition">{index + 1}</span>
                          {item?.image_url ? (
                            item.item_type === "album" || item.item_type === "artist" ? (
                              <Link to={`/${item.item_type}/${item.item_id}`}>
                                <img src={item.image_url} alt={item.item_name || "List item"} className="homeListExpandedImage" />
                              </Link>
                            ) : (
                              <img src={item.image_url} alt={item.item_name || "List item"} className="homeListExpandedImage" />
                            )
                          ) : (
                            <div className="homeListExpandedImage placeholder" />
                          )}
                          <p className="homeListExpandedName">{item.item_name || "Unknown Item"}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {isListExpanded || listItems.length > 8 ? (
                    <button
                      type="button"
                      className="listFeedToggleButton"
                      onClick={() => {
                        setExpandedHomeListIds((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }));
                      }}
                    >
                      {isListExpanded ? "Collapse" : "Show full list"}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="header">
        <h1>sonica</h1>
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
            <div className="userMenuTrigger">
              <UserAvatar imageUrl={authUser.profile_image_url} name={authUser.username} className="menuUserAvatar" />
              <p className="usernameTopRight">{authUser.username}</p>
            </div>
            <div className="userHoverMenu">
              <button
                onClick={() => {
                  navigate("/settings");
                }}
              >
                Profile Settings
              </button>
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
                submitCommunitySubmission={submitCommunitySubmission}
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
                openReviewEditor={openReviewEditor}
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
                getRecentRatings={getRecentRatings}
              />
            }
          />
          <Route
            path="/artist/:artistId"
            element={
              <ArtistPage
                canUseApp={canUseApp}
                spotifyApiFetch={spotifyApiFetch}
                userLists={userLists}
                createNewList={createNewList}
                addItemToList={addItemToList}
                reviewByKey={reviewByKey}
                openReviewEditor={openReviewEditor}
                getAverageRating={getAverageRating}
                getRecentRatings={getRecentRatings}
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
          <Route
            path="/settings"
            element={
              <SettingsPage
                canUseApp={canUseApp}
                authUser={authUser}
                updateCurrentUserProfile={updateCurrentUserProfile}
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
                  >
                    {score}
                  </button>
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
                {reviewEditor.payload &&
                reviewByKey?.[`${reviewEditor.payload.item_type}:${reviewEditor.payload.item_id}`] ? (
                  <button
                    type="button"
                    className="dangerButton"
                    onClick={() => {
                      void deleteReviewFromEditor();
                    }}
                    disabled={reviewEditorSaving || reviewEditorDeleting}
                  >
                    {reviewEditorDeleting ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void submitReviewEditor();
                  }}
                  disabled={reviewEditorSaving || reviewEditorDeleting}
                >
                  {reviewEditorSaving ? "Saving..." : "Save"}
                </button>
                <button type="button" onClick={closeReviewEditor} disabled={reviewEditorSaving || reviewEditorDeleting}>
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
