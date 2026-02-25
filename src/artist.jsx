import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import "./artist.css";

function sortByReleaseDateDesc(items) {
  return [...items].sort((a, b) => new Date(b.release_date || 0) - new Date(a.release_date || 0));
}

function releaseLooksLikeEp(release) {
  const name = String(release?.name || "");
  return Number(release?.total_tracks || 0) > 1 || /\bEP\b/i.test(name);
}

function formatAverage(averageData) {
  if (!averageData || Number(averageData.rating_count || 0) === 0) {
    return "No ratings";
  }
  return `${averageData.average_rating}/10`;
}

function ArtistPage({
  canUseApp,
  spotifyApiFetch,
  userLists,
  createNewList,
  addItemToList,
  reviewByKey,
  openReviewEditor,
  getAverageRating,
}) {
  const { artistId } = useParams();
  const [artist, setArtist] = useState(null);
  const [topTracks, setTopTracks] = useState([]);
  const [releases, setReleases] = useState([]);
  const [artistAverage, setArtistAverage] = useState({ average_rating: null, rating_count: 0 });
  const [trackAverages, setTrackAverages] = useState({});
  const [releaseAverages, setReleaseAverages] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addToListOpen, setAddToListOpen] = useState(false);

  useEffect(() => {
    if (!canUseApp || !artistId) return;

    async function fetchArtistPage() {
      setLoading(true);
      setError("");
      setArtist(null);
      setTopTracks([]);
      setReleases([]);
      setArtistAverage({ average_rating: null, rating_count: 0 });
      setTrackAverages({});
      setReleaseAverages({});

      let resolvedArtistId = artistId;
      let artistResponse = await spotifyApiFetch(`/artists/${encodeURIComponent(resolvedArtistId)}`);

      if (!artistResponse?.ok) {
        const searchResponse = await spotifyApiFetch(
          `/search?q=${encodeURIComponent(artistId)}&type=artist&limit=1`
        );
        const searchData = searchResponse?.ok ? await searchResponse.json() : null;
        const firstArtist = searchData?.artists?.items?.[0];
        if (!firstArtist?.id) {
          throw new Error("Artist request failed");
        }
        resolvedArtistId = firstArtist.id;
        artistResponse = await spotifyApiFetch(`/artists/${resolvedArtistId}`);
      }

      const topTracksResponse = await spotifyApiFetch(`/artists/${resolvedArtistId}/top-tracks?market=US`);

      if (!artistResponse?.ok || !topTracksResponse?.ok) {
        throw new Error("Artist request failed");
      }

      const artistData = await artistResponse.json();
      const topTracksData = await topTracksResponse.json();

      const allReleases = [];
      let offset = 0;
      const limit = 50;

      while (offset < 200) {
        const releasesResponse = await spotifyApiFetch(
          `/artists/${resolvedArtistId}/albums?include_groups=album,single,compilation&market=US&limit=${limit}&offset=${offset}`
        );

        if (!releasesResponse?.ok) break;
        const releasesData = await releasesResponse.json();
        const pageItems = releasesData?.items || [];
        allReleases.push(...pageItems);

        if (!releasesData?.next || pageItems.length < limit) {
          break;
        }
        offset += limit;
      }

      const dedupedReleaseMap = new Map();
      allReleases.forEach((release) => {
        if (release?.id && !dedupedReleaseMap.has(release.id)) {
          dedupedReleaseMap.set(release.id, release);
        }
      });

      const sortedTracks = (topTracksData?.tracks || []).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      const sortedReleases = sortByReleaseDateDesc(Array.from(dedupedReleaseMap.values()));

      setArtist(artistData);
      setTopTracks(sortedTracks);
      setReleases(sortedReleases);

      if (typeof getAverageRating !== "function") return;

      const [artistAverageData, trackAverageEntries, releaseAverageEntries] = await Promise.all([
        getAverageRating("artist", resolvedArtistId).catch(() => null),
        Promise.all(
          sortedTracks.map(async (track) => {
            if (!track?.id) return null;
            try {
              const averageData = await getAverageRating("track", track.id);
              return [
                track.id,
                {
                  average_rating: averageData?.average_rating ?? null,
                  rating_count: Number(averageData?.rating_count || 0),
                },
              ];
            } catch {
              return [track.id, { average_rating: null, rating_count: 0 }];
            }
          })
        ),
        Promise.all(
          sortedReleases.map(async (release) => {
            if (!release?.id) return null;
            try {
              const averageData = await getAverageRating("album", release.id);
              return [
                release.id,
                {
                  average_rating: averageData?.average_rating ?? null,
                  rating_count: Number(averageData?.rating_count || 0),
                },
              ];
            } catch {
              return [release.id, { average_rating: null, rating_count: 0 }];
            }
          })
        ),
      ]);

      setArtistAverage({
        average_rating: artistAverageData?.average_rating ?? null,
        rating_count: Number(artistAverageData?.rating_count || 0),
      });
      setTrackAverages(Object.fromEntries((trackAverageEntries || []).filter(Boolean)));
      setReleaseAverages(Object.fromEntries((releaseAverageEntries || []).filter(Boolean)));
    }

    fetchArtistPage()
      .catch(() => {
        setError("Could not load artist details. Please try again.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [artistId, canUseApp, getAverageRating, spotifyApiFetch]);

  const artistPayload = artist
    ? {
        item_type: "artist",
        item_id: artist.id,
        item_name: artist.name,
        item_subtitle: "Artist",
        image_url: artist.images?.[0]?.url || null,
      }
    : null;
  const existingArtistReview = artistPayload ? reviewByKey?.[`artist:${artistPayload.item_id}`] : null;

  const albums = useMemo(
    () =>
      releases.filter(
        (release) => release.album_group === "album" || (release.album_group !== "compilation" && release.album_type === "album")
      ),
    [releases]
  );
  const compilations = useMemo(
    () => releases.filter((release) => release.album_group === "compilation" || release.album_type === "compilation"),
    [releases]
  );
  const singleGroupReleases = useMemo(
    () => releases.filter((release) => release.album_group === "single" || release.album_type === "single"),
    [releases]
  );
  const eps = useMemo(() => singleGroupReleases.filter((release) => releaseLooksLikeEp(release)), [singleGroupReleases]);
  const singles = useMemo(
    () => singleGroupReleases.filter((release) => !releaseLooksLikeEp(release)),
    [singleGroupReleases]
  );

  function openReleaseReview(release) {
    if (!release?.id || !artist) return;
    openReviewEditor({
      item_type: "album",
      item_id: release.id,
      item_name: release.name,
      item_subtitle: artist.name,
      image_url: release.images?.[0]?.url || null,
    });
  }

  function renderReleaseSection(items) {
    return (
      <div className="artistRows">
        {items.map((release) => (
          <div key={release.id} className="artistReleaseRow">
            <Link to={`/album/${release.id}`} className="artistReleaseLink">
              {release.images?.[0]?.url ? (
                <img src={release.images[0].url} alt={release.name} />
              ) : (
                <div className="artistReleaseImage placeholder" />
              )}
              <div className="artistRowMain">
                <p className="artistRowTitle">{release.name}</p>
                <p>{release.release_date?.slice(0, 4) || ""}</p>
              </div>
            </Link>
            <div className="artistRowActions release">
              <span className="artistRowAverage">{formatAverage(releaseAverages[release.id])}</span>
              <button type="button" onClick={() => openReleaseReview(release)}>
                {reviewByKey?.[`album:${release.id}`]?.rating ? `Rated: ${reviewByKey[`album:${release.id}`].rating}/10` : "Rate"}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!canUseApp) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="artistPage">
      {loading ? <p>Loading artist...</p> : null}
      {error ? <p className="authError">{error}</p> : null}

      {!loading && !error && artist ? (
        <div className="artistLayout">
          <div className="artistHeader">
            {artist.images?.[0]?.url ? (
              <img src={artist.images[0].url} alt={artist.name} className="artistImage" />
            ) : (
              <div className="artistImage placeholder" />
            )}
            <div className="artistHeaderMeta">
              <h2 className="artistName">{artist.name}</h2>
              <p className="artistType">Artist</p>
              <p className="artistAverage">
                {artistAverage.rating_count > 0
                  ? `Average rating: ${artistAverage.average_rating}/10 • ${artistAverage.rating_count} users`
                  : "Average rating: No ratings yet"}
              </p>
              <div className="artistActionRow">
                <div className="artistAddListWrap">
                  <button
                    type="button"
                    onClick={() => {
                      setAddToListOpen((prev) => !prev);
                    }}
                  >
                    Add to List
                  </button>
                  {addToListOpen ? (
                    <div className="artistAddListDropdown">
                      {userLists.length === 0 ? <p className="dropdownEmpty">No lists yet.</p> : null}
                      {userLists.map((list, index) => (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => {
                            if (!artistPayload) return;
                            void addItemToList(list.id, artistPayload);
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
                          if (!newList || !artistPayload) return;
                          await addItemToList(newList.id, artistPayload);
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
                    if (!artistPayload) return;
                    openReviewEditor(artistPayload);
                  }}
                >
                  {existingArtistReview?.rating ? `Rated: ${existingArtistReview.rating}/10` : "Rate"}
                </button>
              </div>
            </div>
          </div>

          <div className="artistBodyColumns">
            <section className="artistColumn">
              <h3>Top Songs</h3>
              {topTracks.length === 0 ? <p>No songs found.</p> : null}
              <div className="artistRows">
                {topTracks.map((track, index) => (
                  <div key={track.id || `${track.name}-${index}`} className="artistRow">
                    <span className="artistRowIndex">{index + 1}</span>
                    <div className="artistRowMain">
                      <p className="artistRowTitle">{track.name}</p>
                      <p>{track.album?.name || ""}</p>
                    </div>
                    <div className="artistRowActions">
                      <span className="artistRowAverage">{formatAverage(trackAverages[track.id])}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (!track?.id) return;
                          openReviewEditor({
                            item_type: "track",
                            item_id: track.id,
                            item_name: track.name,
                            item_subtitle: track.artists?.map((artistItem) => artistItem.name).join(", ") || artist.name,
                            image_url: track.album?.images?.[0]?.url || artist.images?.[0]?.url || null,
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
            </section>

            <section className="artistColumn">
              <h3>Albums</h3>
              {albums.length === 0 ? <p>No albums found.</p> : renderReleaseSection(albums)}

              <h4>EPs</h4>
              {eps.length === 0 ? <p>No EPs found.</p> : renderReleaseSection(eps)}

              <h4>Singles</h4>
              {singles.length === 0 ? <p>No singles found.</p> : renderReleaseSection(singles)}

              <h4>Compilations</h4>
              {compilations.length === 0 ? <p>No compilations found.</p> : renderReleaseSection(compilations)}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ArtistPage;
