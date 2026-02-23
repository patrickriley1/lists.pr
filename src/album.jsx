import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import "./album.css";

function AlbumPage({
  canUseApp,
  spotifyApiFetch,
  userLists,
  createNewList,
  addItemToList,
  addToListenLater,
  listenLaterItems,
  saveReview,
  reviewByKey,
  getAverageRating,
}) {
  const { albumId } = useParams();
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [albumAverage, setAlbumAverage] = useState({ average_rating: null, rating_count: 0 });

  useEffect(() => {
    if (!canUseApp || !albumId) return;

    setLoading(true);
    setError("");

    Promise.all([
      spotifyApiFetch(`/albums/${albumId}`),
      getAverageRating("album", albumId).catch(() => null),
    ])
      .then(async ([response, averageData]) => {
        if (!response || !response.ok) {
          throw new Error("Album request failed");
        }
        const data = await response.json();
        setAlbum(data);
        setAlbumAverage({
          average_rating: averageData?.average_rating ?? null,
          rating_count: Number(averageData?.rating_count || 0),
        });
      })
      .catch(() => {
        setError("Could not load album details. Please try again.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [albumId, canUseApp, getAverageRating, spotifyApiFetch]);

  if (!canUseApp) {
    return <Navigate to="/" replace />;
  }

  const tracks = album?.tracks?.items || [];
  const artists = album?.artists?.map((artist) => artist.name).join(", ") || "";
  const year = album?.release_date?.slice(0, 4) || "";
  const albumPayload = album
    ? {
        item_type: "album",
        item_id: album.id,
        item_name: album.name,
        item_subtitle: artists,
        image_url: album.images?.[0]?.url || null,
      }
    : null;
  const reviewKey = albumPayload ? `${albumPayload.item_type}:${albumPayload.item_id}` : "";
  const existingReview = reviewByKey?.[reviewKey];
  const listenLaterKey = albumPayload ? `album:${albumPayload.item_id}` : "";
  const isInListenLater = (listenLaterItems || []).some(
    (entry) => `${entry.item_type}:${entry.item_id}` === listenLaterKey
  );

  async function promptAndSaveAlbumReview() {
    if (!albumPayload) return;

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
      ...albumPayload,
      rating: parsedRating,
      review_title: titlePrompt.trim() || null,
      review_body: bodyPrompt.trim() || null,
    });
  }

  return (
    <div className="albumPage">
      {loading ? <p>Loading album...</p> : null}
      {error ? <p className="authError">{error}</p> : null}

      {!loading && !error && album ? (
        <div className="albumDetailLayout">
          <div className="albumHeroRow">
            <img src={album.images?.[0]?.url} alt={album.name} className="albumCoverLarge" />

            <div className="albumMeta">
              <div className="albumTitleRow">
                <h2 className="albumDetailTitle">{album.name}</h2>
                <div className="albumActionRow">
                  <div className="albumAddListMenuWrap">
                    <button
                      type="button"
                      onClick={() => {
                        setAddToListOpen((prev) => !prev);
                      }}
                    >
                      Add to List
                    </button>
                    {addToListOpen ? (
                      <div className="albumAddListDropdown">
                        {userLists.length === 0 ? <p className="dropdownEmpty">No lists yet.</p> : null}
                        {userLists.map((list, index) => (
                          <button
                            key={list.id}
                            type="button"
                            onClick={() => {
                              if (!albumPayload) return;
                              void addItemToList(list.id, albumPayload);
                              setAddToListOpen(false);
                            }}
                          >
                            {index + 1}. {list.name}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={async () => {
                            const newList = await createNewList();
                            if (!newList || !albumPayload) return;
                            await addItemToList(newList.id, albumPayload);
                            setAddToListOpen(false);
                          }}
                        >
                          + New List
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!albumPayload) return;
                      void addToListenLater(albumPayload);
                    }}
                  >
                    {isInListenLater ? "Queued" : "Listen Later"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void promptAndSaveAlbumReview();
                    }}
                  >
                    {existingReview?.rating ? `Rated: ${existingReview.rating}/10` : "Review"}
                  </button>
                </div>
              </div>
              <p className="albumDetailArtist">{artists}</p>
              <p className="albumDetailYear">{year}</p>
              <p className="albumDetailAverage">
                {albumAverage.rating_count > 0
                  ? `Average rating: ${albumAverage.average_rating}/10 • ${albumAverage.rating_count} users`
                  : "Average rating: No ratings yet"}
              </p>
            </div>
          </div>

          <div className="albumTrackRows">
            {tracks.map((track, index) => (
              <div key={track.id || `${track.name}-${index}`} className="albumTrackRow">
                <span className="albumTrackNumber">{track.track_number || index + 1}</span>
                <span className="albumTrackTitle">{track.name}</span>
                <span className="albumTrackRating" />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AlbumPage;
