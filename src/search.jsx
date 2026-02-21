import { useState } from "react";
import { Navigate } from "react-router-dom";

function buildItemPayload(item, searchType) {
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

function SearchPage({
  canUseApp,
  spotifyApiFetch,
  userLists,
  createNewList,
  addItemToList,
  saveReview,
  reviewByKey,
}) {
  const [search, setSearch] = useState("");
  const [searchType, setSearchType] = useState("album");
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [expandedAlbumId, setExpandedAlbumId] = useState(null);
  const [albumDetailsById, setAlbumDetailsById] = useState({});
  const [addToListOpenFor, setAddToListOpenFor] = useState(null);

  async function searchSpotify() {
    if (!search.trim() || !canUseApp) return;

    setSearchLoading(true);
    setSearchError("");

    try {
      const response = await spotifyApiFetch(`/search?q=${encodeURIComponent(search)}&type=${searchType}`);

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
                  void addItemToList(list.id, buildItemPayload(item, searchType));
                  setAddToListOpenFor(null);
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
                await addItemToList(newList.id, buildItemPayload(item, searchType));
                setAddToListOpenFor(null);
              }}
            >
              + New List
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  async function promptAndSaveReview(item) {
    const payload = buildItemPayload(item, searchType);
    const reviewKey = `${payload.item_type}:${payload.item_id}`;
    const existingReview = reviewByKey[reviewKey];

    const ratingPrompt = window.prompt(
      "Rate this from 1 to 10",
      existingReview?.rating ? String(existingReview.rating) : ""
    );
    if (ratingPrompt === null) return;

    const parsedRating = Number(ratingPrompt);
    if (Number.isNaN(parsedRating) || parsedRating < 1 || parsedRating > 10) return;

    const titlePrompt = window.prompt("Optional review title", existingReview?.review_title || "");
    if (titlePrompt === null) return;

    const bodyPrompt = window.prompt("Optional review text", existingReview?.review_body || "");
    if (bodyPrompt === null) return;

    await saveReview({
      item_type: payload.item_type,
      item_id: payload.item_id,
      item_name: payload.item_name,
      item_subtitle: payload.item_subtitle,
      image_url: payload.image_url,
      rating: parsedRating,
      review_title: titlePrompt.trim() || null,
      review_body: bodyPrompt.trim() || null,
    });
  }

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
                <img src={searchType === "track" ? item.album?.images?.[0]?.url : item.images?.[0]?.url} width="80" />
                <div className="resultInfo">
                  <p>{item.name}</p>
                  <p>
                    {searchType === "artist" ? "Artist" : item.artists?.map((artist) => artist.name).join(", ")}
                  </p>
                </div>
              </div>

              <div className="resultActions">{renderAddToListMenu(item)}</div>
              <div className="resultActions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void promptAndSaveReview(item);
                  }}
                >
                  {(() => {
                    const itemType = searchType === "track" ? "track" : searchType;
                    const review = reviewByKey[`${itemType}:${item.id}`];
                    return review?.rating ? `Rated: ${review.rating}/10` : "Review";
                  })()}
                </button>
              </div>

              {isExpanded ? (
                <div className="albumExpanded">
                  <p>Released: {releaseYear || "Unknown"}</p>
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

export default SearchPage;
