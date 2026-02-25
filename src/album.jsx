import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import ArtistLinks from "./artist-links";
import "./album.css";

function AlbumPage({
  canUseApp,
  spotifyApiFetch,
  userLists,
  createNewList,
  addItemToList,
  addToListenLater,
  listenLaterItems,
  reviewByKey,
  openReviewEditor,
  getAverageRating,
}) {
  const { albumId } = useParams();
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [albumAverage, setAlbumAverage] = useState({ average_rating: null, rating_count: 0 });
  const [trackAverages, setTrackAverages] = useState({});

  useEffect(() => {
    if (!canUseApp || !albumId) return;

    setLoading(true);
    setError("");
    setTrackAverages({});

    const averageRequest =
      typeof getAverageRating === "function"
        ? getAverageRating("album", albumId).catch(() => null)
        : Promise.resolve(null);

    Promise.all([
      spotifyApiFetch(`/albums/${albumId}`),
      averageRequest,
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

        const tracks = data?.tracks?.items || [];
        if (typeof getAverageRating !== "function" || tracks.length === 0) {
          setTrackAverages({});
          return;
        }

        const trackAverageEntries = await Promise.all(
          tracks.map(async (track) => {
            if (!track?.id) return null;
            try {
              const trackAverageData = await getAverageRating("track", track.id);
              return [
                track.id,
                {
                  average_rating: trackAverageData?.average_rating ?? null,
                  rating_count: Number(trackAverageData?.rating_count || 0),
                },
              ];
            } catch {
              return [track.id, { average_rating: null, rating_count: 0 }];
            }
          })
        );

        setTrackAverages(Object.fromEntries(trackAverageEntries.filter(Boolean)));
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
                      if (!albumPayload) return;
                      openReviewEditor(albumPayload);
                    }}
                  >
                    {existingReview?.rating ? `Rated: ${existingReview.rating}/10` : "Review"}
                  </button>
                </div>
              </div>
              <p className="albumDetailArtist">
                <ArtistLinks artists={album.artists} />
              </p>
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
                <div className="albumTrackActions">
                  <span className="albumTrackAverage">
                    {trackAverages[track.id]?.rating_count > 0
                      ? `${trackAverages[track.id].average_rating}/10`
                      : "No ratings"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!track?.id) return;
                      openReviewEditor({
                        item_type: "track",
                        item_id: track.id,
                        item_name: track.name,
                        item_subtitle: track.artists?.map((artist) => artist.name).join(", ") || artists,
                        image_url: album.images?.[0]?.url || null,
                      });
                    }}
                  >
                    {reviewByKey?.[`track:${track.id}`]?.rating
                      ? `Rated: ${reviewByKey[`track:${track.id}`].rating}/10`
                      : "Rate"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AlbumPage;
