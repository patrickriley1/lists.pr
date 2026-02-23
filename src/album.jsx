import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import "./album.css";

function AlbumPage({ canUseApp, spotifyApiFetch }) {
  const { albumId } = useParams();
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canUseApp || !albumId) return;

    setLoading(true);
    setError("");

    spotifyApiFetch(`/albums/${albumId}`)
      .then(async (response) => {
        if (!response || !response.ok) {
          throw new Error("Album request failed");
        }
        const data = await response.json();
        setAlbum(data);
      })
      .catch(() => {
        setError("Could not load album details. Please try again.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [albumId, canUseApp, spotifyApiFetch]);

  if (!canUseApp) {
    return <Navigate to="/" replace />;
  }

  const tracks = album?.tracks?.items || [];
  const artists = album?.artists?.map((artist) => artist.name).join(", ") || "";
  const year = album?.release_date?.slice(0, 4) || "";

  return (
    <div className="albumPage">
      <Link className="albumBackLink" to="/search">
        Back to Search
      </Link>

      {loading ? <p>Loading album...</p> : null}
      {error ? <p className="authError">{error}</p> : null}

      {!loading && !error && album ? (
        <div className="albumDetailLayout">
          <div className="albumHeroRow">
            <img src={album.images?.[0]?.url} alt={album.name} className="albumCoverLarge" />

            <div className="albumMeta">
              <h2 className="albumDetailTitle">{album.name}</h2>
              <p className="albumDetailArtist">{artists}</p>
              <p className="albumDetailYear">{year}</p>
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
