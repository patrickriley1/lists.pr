import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import ArtistLinks from "./artist-links";
import "./search.css";

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
  addToListenLater,
  listenLaterItems,
  reviewByKey,
  openReviewEditor,
  searchUsers,
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [searchType, setSearchType] = useState("album");
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [addToListOpenFor, setAddToListOpenFor] = useState(null);
  const listenLaterByKey = (listenLaterItems || []).reduce((acc, entry) => {
    acc[`${entry.item_type}:${entry.item_id}`] = entry;
    return acc;
  }, {});

  async function searchSpotify() {
    if (!search.trim() || !canUseApp) return;

    setSearchLoading(true);
    setSearchError("");

    try {
      if (searchType === "user") {
        const users = await searchUsers(search.trim());
        setResults(users || []);
        return;
      }

      const response = await spotifyApiFetch(`/search?q=${encodeURIComponent(search)}&type=${searchType}`);

      if (!response) {
        setSearchError("Spotify API unavailable. Please try again.");
        return;
      }

      if (!response.ok) {
        setSearchError("Search failed. Please try again.");
        return;
      }

      const data = await response.json();

      if (searchType === "album") {
        setResults(data.albums?.items || []);
        return;
      }

      if (searchType === "track") {
        setResults(data.tracks?.items || []);
        return;
      }

      setResults(data.artists?.items || []);
    } catch {
      setSearchError("Search failed. Check your connection and try again.");
    } finally {
      setSearchLoading(false);
    }
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
          }}
        >
          Artist Search
        </button>
        <button
          className={`searchCard ${searchType === "user" ? "active" : ""}`}
          type="button"
          onClick={() => {
            setSearchType("user");
            setResults([]);
          }}
        >
          User Search
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
          placeholder={`Search for a ${searchType}`}
        />
        <button type="submit" disabled={searchLoading}>
          {searchLoading ? "Searching..." : "Search"}
        </button>
      </form>

      {searchError ? <p className="authError">{searchError}</p> : null}

      <div className="resultsList">
        {results.map((item) => {
          const isAlbum = searchType === "album";
          const isUser = searchType === "user";
          const isArtist = searchType === "artist";

          return (
            <div
              key={isUser ? item.username : item.id}
              className="resultItem"
              onClick={() => {
                if (isAlbum) {
                  navigate(`/album/${item.id}`);
                }
                if (isUser) {
                  navigate(`/user/${item.username}`);
                }
                if (isArtist) {
                  navigate(`/artist/${item.id}`);
                }
              }}
            >
              <div className="resultTopRow">
                <div className="resultMain">
                  {isUser ? (
                    <div className="resultUserAvatar">{item.username?.[0]?.toUpperCase() || "U"}</div>
                  ) : (
                    <img src={searchType === "track" ? item.album?.images?.[0]?.url : item.images?.[0]?.url} width="80" />
                  )}
                  <div className="resultInfo">
                    <p>{isUser ? item.username : item.name}</p>
                    <p>
                      {isUser
                        ? "User"
                        : searchType === "artist"
                          ? "Artist"
                          : <ArtistLinks artists={item.artists} />}
                    </p>
                  </div>
                </div>

                {searchType !== "album" && searchType !== "user" ? (
                  <div className="resultActionsRow">
                    <div className="resultActions">{renderAddToListMenu(item)}</div>
                    {searchType === "track" ? (
                      <div className="resultActions">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void addToListenLater(buildItemPayload(item, searchType));
                          }}
                        >
                          {listenLaterByKey[`${searchType}:${item.id}`] ? "Queued" : "Listen Later"}
                        </button>
                      </div>
                    ) : null}
                    <div className="resultActions">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openReviewEditor(buildItemPayload(item, searchType));
                          }}
                        >
                        {(() => {
                          const itemType = searchType === "track" ? "track" : searchType;
                          const review = reviewByKey[`${itemType}:${item.id}`];
                          return review?.rating ? `Rated: ${review.rating}/10` : "Review";
                        })()}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SearchPage;
