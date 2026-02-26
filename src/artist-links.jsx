import { Fragment } from "react";
import { Link } from "react-router-dom";

function normalizeArtists({ artists, text }) {
  if (Array.isArray(artists) && artists.length > 0) {
    return artists
      .map((artist) => ({
        id: artist?.id || "",
        name: String(artist?.name || "").trim(),
      }))
      .filter((artist) => artist.name);
  }

  if (!text) return [];
  return String(text)
    .split(",")
    .map((name) => ({ id: "", name: name.trim() }))
    .filter((artist) => artist.name);
}

function buildArtistPath(artist) {
  return `/artist/${encodeURIComponent(artist.id || artist.name)}`;
}

function ArtistLinks({ artists, text, className = "" }) {
  const normalizedArtists = normalizeArtists({ artists, text });
  if (normalizedArtists.length === 0) return null;

  return (
    <>
      {normalizedArtists.map((artist, index) => (
        <Fragment key={`${artist.id || artist.name}-${index}`}>
          {index > 0 ? ", " : null}
          <Link to={buildArtistPath(artist)} className={className}>
            {artist.name}
          </Link>
        </Fragment>
      ))}
    </>
  );
}

export default ArtistLinks;
