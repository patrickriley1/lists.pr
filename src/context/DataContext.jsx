import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useAuth } from "./AuthContext";

const DataContext = createContext(null);

const FEED_LIMIT = 40;

function sortListsByRecency(lists) {
  return [...lists].sort(
    (a, b) =>
      new Date(b.updated_at || b.created_at || 0) -
      new Date(a.updated_at || a.created_at || 0)
  );
}

export function DataProvider({ children }) {
  const { authToken, authUser, updateAuthUser } = useAuth();

  const [userLists, setUserLists] = useState([]);
  const [reviewByKey, setReviewByKey] = useState({});
  const [reviewEntries, setReviewEntries] = useState([]);
  const [listenLaterItems, setListenLaterItems] = useState([]);
  const [feedEntries, setFeedEntries] = useState([]);
  const [publicLists, setPublicLists] = useState([]);
  const [feedOffset, setFeedOffset] = useState(0);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [expandedHomeListIds, setExpandedHomeListIds] = useState({});

  const [reviewEditor, setReviewEditor] = useState({ open: false, payload: null });
  const [reviewDraft, setReviewDraft] = useState({ rating: 0, title: "", body: "" });
  const [reviewEditorError, setReviewEditorError] = useState("");
  const [reviewEditorSaving, setReviewEditorSaving] = useState(false);
  const [reviewEditorDeleting, setReviewEditorDeleting] = useState(false);

  useEffect(() => {
    if (!authToken) {
      setUserLists([]);
      setReviewByKey({});
      setReviewEntries([]);
      setListenLaterItems([]);
      setFeedEntries([]);
      setPublicLists([]);
      setFeedOffset(0);
      setFeedHasMore(true);
      setExpandedHomeListIds({});
      setReviewEditor({ open: false, payload: null });
      setReviewDraft({ rating: 0, title: "", body: "" });
      setReviewEditorError("");
      return;
    }

    Promise.all([
      apiFetch("/api/ratings", { token: authToken }),
      apiFetch("/api/lists", { token: authToken }),
      apiFetch("/api/listen-later", { token: authToken }),
      apiFetch(`/api/feed?limit=${FEED_LIMIT}&offset=0`, { token: authToken }),
      apiFetch("/api/lists/discover?limit=24", { token: authToken }),
    ])
      .then(([ratingsData, listsData, listenLaterData, feedData, publicListsData]) => {
        const ratings = ratingsData || [];
        setReviewEntries(ratings);
        setReviewByKey(
          ratings.reduce((acc, row) => {
            const itemType = row.item_type || "album";
            const itemId = row.item_id || row.album_id;
            if (itemId) acc[`${itemType}:${itemId}`] = row;
            return acc;
          }, {})
        );

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

        setListenLaterItems(listenLaterData || []);

        const feed = feedData || [];
        setFeedEntries(feed);
        setFeedOffset(FEED_LIMIT);
        setFeedHasMore(feed.length >= FEED_LIMIT);

        setPublicLists(publicListsData || []);
      })
      .catch((err) => {
        console.error("Failed to hydrate user data", err);
      });
  }, [authToken]);

  async function loadMoreFeed() {
    if (!feedHasMore) return;
    try {
      const data = await apiFetch(
        `/api/feed?limit=${FEED_LIMIT}&offset=${feedOffset}`,
        { token: authToken }
      );
      const newEntries = data || [];
      setFeedEntries((prev) => [...prev, ...newEntries]);
      setFeedOffset((prev) => prev + FEED_LIMIT);
      setFeedHasMore(newEntries.length >= FEED_LIMIT);
    } catch {
      // fail silently — user can retry
    }
  }

  async function renameList(listId) {
    const list = userLists.find((entry) => entry.id === listId);
    const rawName = window.prompt("Rename list", list?.name || "");
    const name = rawName?.trim();
    if (!name) return;
    try {
      const updated = await apiFetch(`/api/lists/${listId}`, {
        method: "PATCH",
        body: { name },
        token: authToken,
      });
      setUserLists((prev) =>
        sortListsByRecency(
          prev.map((entry) =>
            entry.id === listId
              ? { ...entry, name: updated.name, updated_at: updated.updated_at }
              : entry
          )
        )
      );
    } catch {}
  }

  async function deleteList(listId) {
    if (!window.confirm("Delete this list?")) return;
    try {
      await apiFetch(`/api/lists/${listId}`, { method: "DELETE", token: authToken });
      setUserLists((prev) => prev.filter((entry) => entry.id !== listId));
    } catch {}
  }

  async function createNewList() {
    const rawName = window.prompt("Name your new list");
    const name = rawName?.trim();
    if (!name) return null;
    try {
      const list = await apiFetch("/api/lists", {
        method: "POST",
        body: { name },
        token: authToken,
      });
      const normalizedList = { ...list, items: [] };
      setUserLists((prev) => sortListsByRecency([...prev, normalizedList]));
      return normalizedList;
    } catch {
      return null;
    }
  }

  async function addItemToList(listId, payload) {
    try {
      const savedItem = await apiFetch(`/api/lists/${listId}/items`, {
        method: "POST",
        body: payload,
        token: authToken,
      });
      setUserLists((prev) =>
        sortListsByRecency(
          prev.map((list) => {
            if (list.id !== listId) return list;
            const exists = (list.items || []).some(
              (entry) =>
                entry.item_type === savedItem.item_type &&
                entry.item_id === savedItem.item_id
            );
            if (exists) {
              return {
                ...list,
                items: list.items.map((entry) =>
                  entry.item_type === savedItem.item_type &&
                  entry.item_id === savedItem.item_id
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
    } catch {}
  }

  async function reorderListItems(listId, orderedItemIds) {
    try {
      const data = await apiFetch(`/api/lists/${listId}/items/reorder`, {
        method: "PATCH",
        body: { ordered_item_ids: orderedItemIds },
        token: authToken,
      });
      setUserLists((prev) =>
        sortListsByRecency(
          prev.map((list) =>
            list.id === listId
              ? { ...list, items: data.items || [], updated_at: new Date().toISOString() }
              : list
          )
        )
      );
    } catch {}
  }

  async function removeItemFromList(listId, listItemId) {
    try {
      const data = await apiFetch(`/api/lists/${listId}/items/${listItemId}`, {
        method: "DELETE",
        token: authToken,
      });
      setUserLists((prev) =>
        sortListsByRecency(
          prev.map((list) =>
            list.id === listId
              ? { ...list, items: data.items || [], updated_at: new Date().toISOString() }
              : list
          )
        )
      );
    } catch {}
  }

  async function saveReview(payload) {
    const savedReview = await apiFetch("/api/ratings", {
      method: "POST",
      body: payload,
      token: authToken,
    });

    const itemType = savedReview.item_type || "album";
    const itemId = savedReview.item_id || savedReview.album_id;
    if (!itemId) return;
    const reviewKey = `${itemType}:${itemId}`;

    setReviewByKey((prev) => ({ ...prev, [reviewKey]: savedReview }));
    setReviewEntries((prev) => {
      const rest = prev.filter((entry) => {
        const eType = entry.item_type || "album";
        const eId = entry.item_id || entry.album_id;
        return `${eType}:${eId}` !== reviewKey;
      });
      return [savedReview, ...rest];
    });
    setListenLaterItems((prev) =>
      prev.filter((entry) => `${entry.item_type}:${entry.item_id}` !== reviewKey)
    );
    setFeedEntries((prev) => {
      const idx = prev.findIndex((entry) => entry.id === savedReview.id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...savedReview };
      return next;
    });
  }

  async function deleteReview(itemType, itemId) {
    await apiFetch(
      `/api/ratings?item_type=${encodeURIComponent(itemType)}&item_id=${encodeURIComponent(itemId)}`,
      { method: "DELETE", token: authToken }
    );

    const reviewKey = `${itemType}:${itemId}`;
    setReviewByKey((prev) => {
      const next = { ...prev };
      delete next[reviewKey];
      return next;
    });
    setReviewEntries((prev) =>
      prev.filter((entry) => {
        const eType = entry.item_type || "album";
        const eId = entry.item_id || entry.album_id;
        return `${eType}:${eId}` !== reviewKey;
      })
    );
    setFeedEntries((prev) =>
      prev.filter((entry) => {
        const eType = entry.item_type || "album";
        const eId = entry.item_id || entry.album_id;
        return (
          entry.app_user_id !== authUser?.id || `${eType}:${eId}` !== reviewKey
        );
      })
    );
  }

  function openReviewEditor(payload) {
    if (!payload?.item_type || !payload?.item_id) return;
    const existing = reviewByKey[`${payload.item_type}:${payload.item_id}`];
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
    try {
      await saveReview({
        ...reviewEditor.payload,
        rating: reviewDraft.rating,
        review_title: reviewDraft.title.trim() || null,
        review_body: reviewDraft.body.trim() || null,
      });
      setReviewEditor({ open: false, payload: null });
      setReviewDraft({ rating: 0, title: "", body: "" });
      setReviewEditorError("");
    } catch {
      setReviewEditorError("Could not save review. Please try again.");
    } finally {
      setReviewEditorSaving(false);
    }
  }

  async function deleteReviewFromEditor() {
    const payload = reviewEditor.payload;
    if (!payload?.item_type || !payload?.item_id) return;
    if (!window.confirm("Delete this review?")) return;
    setReviewEditorDeleting(true);
    setReviewEditorError("");
    try {
      await deleteReview(payload.item_type, payload.item_id);
      setReviewEditor({ open: false, payload: null });
      setReviewDraft({ rating: 0, title: "", body: "" });
      setReviewEditorError("");
    } catch {
      setReviewEditorError("Could not delete review. Please try again.");
    } finally {
      setReviewEditorDeleting(false);
    }
  }

  async function addToListenLater(payload) {
    if (!["album", "track"].includes(payload?.item_type)) return;
    try {
      const saved = await apiFetch("/api/listen-later", {
        method: "POST",
        body: payload,
        token: authToken,
      });
      setListenLaterItems((prev) => {
        const rest = prev.filter(
          (entry) =>
            !(entry.item_type === saved.item_type && entry.item_id === saved.item_id)
        );
        return [saved, ...rest];
      });
    } catch {}
  }

  async function removeListenLaterItem(itemRowId) {
    try {
      await apiFetch(`/api/listen-later/${itemRowId}`, {
        method: "DELETE",
        token: authToken,
      });
      setListenLaterItems((prev) => prev.filter((entry) => entry.id !== itemRowId));
    } catch {}
  }

  async function getAverageRating(itemType, itemId) {
    return apiFetch(
      `/api/ratings/average?item_type=${encodeURIComponent(itemType)}&item_id=${encodeURIComponent(itemId)}`,
      { token: authToken }
    );
  }

  async function getRecentRatings(itemType, itemId, limit = 10) {
    try {
      const data = await apiFetch(
        `/api/ratings/recent?item_type=${encodeURIComponent(itemType)}&item_id=${encodeURIComponent(itemId)}&limit=${limit}`,
        { token: authToken }
      );
      return Array.isArray(data) ? data : [];
    } catch {
      try {
        const feedData = await apiFetch("/api/feed?limit=100", { token: authToken });
        if (!Array.isArray(feedData)) return [];
        return feedData
          .filter(
            (entry) =>
              String(entry?.item_type || "") === String(itemType) &&
              String(entry?.item_id || "") === String(itemId)
          )
          .slice(0, limit);
      } catch {
        return [];
      }
    }
  }

  async function getCharts(itemType, limit = 50) {
    return apiFetch(
      `/api/charts?item_type=${encodeURIComponent(itemType)}&limit=${encodeURIComponent(limit)}`,
      { token: authToken }
    );
  }

  async function searchUsers(query) {
    return apiFetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
      token: authToken,
    });
  }

  async function submitCommunitySubmission(payload) {
    return apiFetch("/api/community/submissions", {
      method: "POST",
      body: payload,
      token: authToken,
    });
  }

  async function getUserProfile(username) {
    return apiFetch(
      `/api/users/${encodeURIComponent(username)}/profile`,
      { token: authToken }
    );
  }

  async function toggleFeedLike(reviewId, currentlyLiked) {
    try {
      const data = await apiFetch(`/api/feed/reviews/${reviewId}/like`, {
        method: currentlyLiked ? "DELETE" : "POST",
        token: authToken,
      });
      setFeedEntries((prev) =>
        prev.map((entry) =>
          entry.id === reviewId
            ? { ...entry, like_count: data.like_count, liked_by_me: data.liked_by_me }
            : entry
        )
      );
    } catch {}
  }

  async function updateCurrentUserProfile({ username, profileImageUrl }) {
    const data = await apiFetch("/api/auth/me", {
      method: "PATCH",
      body: { username, profile_image_url: profileImageUrl || null },
      token: authToken,
    });

    updateAuthUser(data);

    setFeedEntries((prev) =>
      prev.map((entry) =>
        entry.app_user_id === data.id
          ? {
              ...entry,
              username: data.username,
              user_profile_image_url: data.profile_image_url || null,
            }
          : entry
      )
    );
    setPublicLists((prev) =>
      prev.map((entry) =>
        entry.app_user_id === data.id
          ? {
              ...entry,
              username: data.username,
              user_profile_image_url: data.profile_image_url || null,
            }
          : entry
      )
    );

    return data;
  }

  return (
    <DataContext.Provider
      value={{
        userLists,
        setUserLists,
        reviewByKey,
        reviewEntries,
        listenLaterItems,
        feedEntries,
        publicLists,
        feedHasMore,
        expandedHomeListIds,
        setExpandedHomeListIds,
        reviewEditor,
        reviewDraft,
        setReviewDraft,
        reviewEditorError,
        reviewEditorSaving,
        reviewEditorDeleting,
        loadMoreFeed,
        createNewList,
        renameList,
        deleteList,
        addItemToList,
        reorderListItems,
        removeItemFromList,
        addToListenLater,
        removeListenLaterItem,
        openReviewEditor,
        closeReviewEditor,
        submitReviewEditor,
        deleteReviewFromEditor,
        getAverageRating,
        getRecentRatings,
        getCharts,
        searchUsers,
        submitCommunitySubmission,
        getUserProfile,
        toggleFeedLike,
        updateCurrentUserProfile,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
