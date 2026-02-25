import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import ArtistLinks from "./artist-links";
import "./user.css";

function UserPage({ canUseApp, getUserProfile }) {
  const { username } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeListId, setActiveListId] = useState(null);

  useEffect(() => {
    if (!canUseApp || !username) return;

    setLoading(true);
    setError("");
    setProfile(null);
    setActiveListId(null);

    getUserProfile(username)
      .then((data) => {
        if (!data) {
          setError("User not found.");
          return;
        }
        setProfile(data);
      })
      .catch(() => {
        setError("Could not load user page.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [canUseApp, getUserProfile, username]);

  const activeList = useMemo(
    () => (profile?.lists || []).find((list) => list.id === activeListId) || null,
    [activeListId, profile]
  );

  if (!canUseApp) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="userPage">
      {!loading && !error && profile ? (
        <div className="userHeader">
          {profile.user?.profile_image_url ? (
            <img
              src={profile.user.profile_image_url}
              alt={profile.user.username || username}
              className="userProfileAvatar"
            />
          ) : (
            <div className="userProfileAvatar placeholder">
              {(profile.user?.username || username)?.[0]?.toUpperCase() || "U"}
            </div>
          )}
          <h2 className="pageTitle">{profile.user?.username || username}</h2>
        </div>
      ) : (
        <h2 className="pageTitle">{username}</h2>
      )}

      {loading ? <p>Loading user...</p> : null}
      {error ? <p className="authError">{error}</p> : null}

      {!loading && !error && profile ? (
        <div className="userGrid">
          <div className="userColumn">
            <h3>Lists</h3>
            {(profile.lists || []).length === 0 ? <p>No lists yet.</p> : null}
            <div className="userListCards">
              {(profile.lists || []).map((list) => {
                const previewItems = [...(list.items || [])]
                  .sort((a, b) => (a.position || 0) - (b.position || 0))
                  .slice(0, 4);

                return (
                  <button
                    key={list.id}
                    type="button"
                    className={`userListCard ${activeListId === list.id ? "active" : ""}`}
                    onClick={() => {
                      setActiveListId((prev) => (prev === list.id ? null : list.id));
                    }}
                  >
                    <p className="userListTitle">{list.name}</p>
                    <div className="userListPreviewGrid">
                      {[0, 1, 2, 3].map((slot) => {
                        const item = previewItems[slot];
                        return item?.image_url ? (
                          <img key={slot} src={item.image_url} alt={item.item_name} />
                        ) : (
                          <div key={slot} className="userPreviewPlaceholder" />
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>

            {activeList ? (
              <div className="userActiveList">
                <h4>{activeList.name}</h4>
                <div className="userActiveItems">
                  {[...(activeList.items || [])]
                    .sort((a, b) => (a.position || 0) - (b.position || 0))
                    .map((item, index) => (
                      <div key={item.id} className="userActiveItem">
                        <span>{index + 1}</span>
                        {item.image_url ? <img src={item.image_url} alt={item.item_name} /> : <div className="userItemPlaceholder" />}
                        <p>
                          {item.item_type === "artist" ? (
                            <Link to={`/artist/${item.item_id}`}>{item.item_name}</Link>
                          ) : item.item_type === "album" ? (
                            <Link to={`/album/${item.item_id}`}>{item.item_name}</Link>
                          ) : (
                            item.item_name
                          )}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="userColumn">
            <h3>Recent Reviews</h3>
            {(profile.ratings || []).length === 0 ? <p>No reviews yet.</p> : null}
            <div className="userReviews">
              {(profile.ratings || []).map((entry) => (
                <div key={entry.id} className="userReviewCard">
                  {entry.image_url ? <img src={entry.image_url} alt={entry.item_name || "Reviewed item"} /> : <div className="userItemPlaceholder" />}
                  <div>
                    <p className="userReviewItem">
                      {entry.item_type === "artist" ? (
                        <Link to={`/artist/${entry.item_id}`}>{entry.item_name || "Unknown Item"}</Link>
                      ) : entry.item_type === "album" ? (
                        <Link to={`/album/${entry.item_id}`}>{entry.item_name || "Unknown Item"}</Link>
                      ) : (
                        entry.item_name || "Unknown Item"
                      )}
                    </p>
                    <p>
                      {entry.item_type === "artist"
                        ? entry.item_subtitle || ""
                        : <ArtistLinks text={entry.item_subtitle || ""} />}
                    </p>
                    {entry.review_title ? <p className="userReviewTitle">{entry.review_title}</p> : null}
                    {entry.review_body ? <p>{entry.review_body}</p> : null}
                    <p>Rating: {entry.rating}/10</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default UserPage;
