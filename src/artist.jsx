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

function ArtistPage({
  canUseApp,
  spotifyApiFetch,
  userLists,
  createNewList,
  addItemToList,
  reviewByKey,
  openReviewEditor,
}) {
  const { artistId } = useParams();
  const [artist, setArtist] = useState(null);
  const [topTracks, setTopTracks] = useState([]);
  const [releases, setReleases] = useState([]);
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

      const artistResponse = await spotifyApiFetch(`/artists/${artistId}`);
      const topTracksResponse = await spotifyApiFetch(`/artists/${artistId}/top-tracks?market=US`);

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
          `/artists/${artistId}/albums?include_groups=album,single,compilation&market=US&limit=${limit}&offset=${offset}`
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

      setArtist(artistData);
      setTopTracks((topTracksData?.tracks || []).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)));
      setReleases(sortByReleaseDateDesc(Array.from(dedupedReleaseMap.values())));
    }

    fetchArtistPage()
      .catch(() => {
        setError("Could not load artist details. Please try again.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [artistId, canUseApp, spotifyApiFetch]);

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
                  {existingArtistReview?.rating ? `Rated: ${existingArtistReview.rating}/10` : "Review"}
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
                    <p className="artistRowRight">{track.popularity ?? 0}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="artistColumn">
              <h3>Albums</h3>
              {albums.length === 0 ? <p>No albums found.</p> : null}
              <div className="artistRows">
                {albums.map((release) => (
                  <Link key={release.id} to={`/album/${release.id}`} className="artistReleaseRow">
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
                ))}
              </div>

              <h4>EPs</h4>
              <div className="artistRows">
                {eps.length === 0 ? <p>No EPs found.</p> : null}
                {eps.map((release) => (
                  <Link key={release.id} to={`/album/${release.id}`} className="artistReleaseRow">
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
                ))}
              </div>

              <h4>Singles</h4>
              <div className="artistRows">
                {singles.length === 0 ? <p>No singles found.</p> : null}
                {singles.map((release) => (
                  <Link key={release.id} to={`/album/${release.id}`} className="artistReleaseRow">
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
                ))}
              </div>

              <h4>Compilations</h4>
              <div className="artistRows">
                {compilations.length === 0 ? <p>No compilations found.</p> : null}
                {compilations.map((release) => (
                  <Link key={release.id} to={`/album/${release.id}`} className="artistReleaseRow">
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
                ))}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ArtistPage;
