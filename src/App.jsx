import { lazy, Suspense, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { useAuth } from "./context/AuthContext";
import { useData } from "./context/DataContext";
import ArtistLinks from "./artist-links";
import "./App.css";

const SearchPage = lazy(() => import("./search"));
const LibraryPage = lazy(() => import("./library"));
const AlbumPage = lazy(() => import("./album"));
const ArtistPage = lazy(() => import("./artist"));
const UserPage = lazy(() => import("./user"));
const ChartsPage = lazy(() => import("./charts"));
const SettingsPage = lazy(() => import("./settings"));

function UserAvatar({ imageUrl, name, className }) {
  if (imageUrl) {
    return <img src={imageUrl} alt={name || "User"} className={className} />;
  }
  return (
    <div className={`${className} placeholder`}>{name?.[0]?.toUpperCase() || "U"}</div>
  );
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const { authToken, authUser, login, register, logout } = useAuth();
  const {
    feedEntries,
    publicLists,
    feedHasMore,
    expandedHomeListIds,
    setExpandedHomeListIds,
    toggleFeedLike,
    loadMoreFeed,
    reviewEditor,
    reviewDraft,
    setReviewDraft,
    reviewEditorError,
    reviewEditorSaving,
    reviewEditorDeleting,
    reviewByKey,
    closeReviewEditor,
    submitReviewEditor,
    deleteReviewFromEditor,
  } = useData();

  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError("");
    try {
      if (authMode === "register") {
        await register(authForm.username, authForm.email, authForm.password);
      } else {
        await login(authForm.username, authForm.password);
      }
      navigate("/");
    } catch (err) {
      setAuthError(err.message || "Authentication failed");
    }
  }

  function renderAuthCard() {
    return (
      <form className="authCard" onSubmit={submitAuth}>
        <h2>{authMode === "register" ? "Create Account" : "Login"}</h2>
        <input
          value={authForm.username}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, username: e.target.value }))}
          placeholder="Username"
        />
        {authMode === "register" ? (
          <input
            type="email"
            value={authForm.email}
            onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="Email"
          />
        ) : null}
        <input
          type="password"
          value={authForm.password}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
          placeholder="Password"
        />
        {authError ? <p className="authError">{authError}</p> : null}
        <div className="authActions">
          <button type="submit">{authMode === "register" ? "Register" : "Login"}</button>
          <button
            type="button"
            onClick={() => {
              setAuthError("");
              setAuthMode((prev) => (prev === "login" ? "register" : "login"));
            }}
          >
            {authMode === "login" ? "Need an account?" : "Have an account?"}
          </button>
        </div>
      </form>
    );
  }

  function renderHomePage() {
    if (!authToken) {
      return (
        <div className="pageSection">
          <h2 className="pageTitle">Home</h2>
          <p className="pageIntro">
            Create an account or sign in to start building your music library.
          </p>
          {renderAuthCard()}
        </div>
      );
    }

    const feedEntriesWithReviewText = (feedEntries || []).filter((entry) => {
      const hasTitle =
        typeof entry.review_title === "string" && entry.review_title.trim().length > 0;
      const hasBody =
        typeof entry.review_body === "string" && entry.review_body.trim().length > 0;
      return hasTitle && hasBody;
    });

    const combinedHomeFeed = [
      ...(publicLists || []).map((list) => ({
        activity_type: "list",
        sort_date: list.updated_at || list.created_at || null,
        ...list,
      })),
      ...feedEntriesWithReviewText.map((entry) => ({
        activity_type: "review",
        sort_date: entry.updated_at || entry.created_at || null,
        ...entry,
      })),
    ].sort((a, b) => new Date(b.sort_date || 0) - new Date(a.sort_date || 0));

    return (
      <div className="pageSection">
        <h2 className="pageTitle">Home</h2>
        <div className="feedList">
          {combinedHomeFeed.length === 0 ? <p>No activity yet.</p> : null}
          {combinedHomeFeed.map((entry) => {
            const isListEntry = entry.activity_type === "list";
            const listItems = isListEntry ? entry.items || [] : [];
            const isListExpanded = isListEntry
              ? Boolean(expandedHomeListIds[entry.id])
              : false;
            const visibleListItems = isListEntry
              ? isListExpanded
                ? listItems
                : listItems.slice(0, 8)
              : [];

            return (
              <div key={`${entry.activity_type}:${entry.id}`} className="feedCard">
                {entry.activity_type === "review" ? (
                  <>
                    {entry.image_url ? (
                      <img
                        src={entry.image_url}
                        alt={entry.item_name || "Reviewed item"}
                        className="feedImage"
                      />
                    ) : (
                      <div className="feedImage placeholder" />
                    )}
                    <div className="feedBody">
                      <div className="feedHeaderRow">
                        <div className="feedAuthor">
                          <UserAvatar
                            imageUrl={entry.user_profile_image_url}
                            name={entry.username}
                            className="feedUserAvatar"
                          />
                          <Link className="feedUsername" to={`/user/${entry.username}`}>
                            {entry.username}
                          </Link>
                        </div>
                        <div className="feedHeaderRight">
                          <p className="feedRating">{entry.rating}/10</p>
                          <button
                            type="button"
                            className={`feedLikeButton ${entry.liked_by_me ? "active" : ""}`}
                            onClick={() => {
                              void toggleFeedLike(entry.id, Boolean(entry.liked_by_me));
                            }}
                            aria-label="Like review"
                          >
                            <span className="feedLikeIcon">
                              {entry.liked_by_me ? "♥" : "♡"}
                            </span>
                            <span>{entry.like_count || 0}</span>
                          </button>
                        </div>
                      </div>
                      <p className="feedItemName">
                        {entry.item_type === "artist" ? (
                          <Link to={`/artist/${entry.item_id}`}>
                            {entry.item_name || "Unknown Item"}
                          </Link>
                        ) : entry.item_type === "album" ? (
                          <Link to={`/album/${entry.item_id}`}>
                            {entry.item_name || "Unknown Item"}
                          </Link>
                        ) : (
                          entry.item_name || "Unknown Item"
                        )}
                      </p>
                      <p>
                        {entry.item_type === "artist" ? (
                          entry.item_subtitle || ""
                        ) : (
                          <ArtistLinks text={entry.item_subtitle || ""} />
                        )}
                      </p>
                      {entry.review_title ? (
                        <p className="feedReviewTitle">{entry.review_title}</p>
                      ) : null}
                      {entry.review_body ? (
                        <p className="feedReviewBody">{entry.review_body}</p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="feedBody listFeedBody">
                    <div className="feedHeaderRow">
                      <div className="feedAuthor">
                        <UserAvatar
                          imageUrl={entry.user_profile_image_url}
                          name={entry.username}
                          className="feedUserAvatar"
                        />
                        <Link className="feedUsername" to={`/user/${entry.username}`}>
                          {entry.username}
                        </Link>
                      </div>
                      <p className="listFeedMeta">{Number(entry.item_count || 0)} items</p>
                    </div>
                    <p className="feedItemName">{entry.name || "Untitled List"}</p>
                    {!isListExpanded ? (
                      <div
                        className="listFeedPreview"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setExpandedHomeListIds((prev) => ({
                            ...prev,
                            [entry.id]: true,
                          }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          setExpandedHomeListIds((prev) => ({
                            ...prev,
                            [entry.id]: true,
                          }));
                        }}
                      >
                        {visibleListItems.map((item, index) =>
                          item?.image_url ? (
                            <img
                              key={`${entry.id}-${item.item_name || "item"}-${index}`}
                              src={item.image_url}
                              alt={item.item_name || "List item"}
                            />
                          ) : (
                            <div
                              key={`${entry.id}-placeholder-${index}`}
                              className="listFeedPreviewPlaceholder"
                            />
                          )
                        )}
                      </div>
                    ) : (
                      <div className="homeListExpandedGrid">
                        {listItems.map((item, index) => (
                          <div
                            key={`${entry.id}-expanded-${item.item_name || "item"}-${index}`}
                            className="homeListExpandedItem"
                          >
                            <span className="homeListExpandedPosition">{index + 1}</span>
                            {item?.image_url ? (
                              item.item_type === "album" || item.item_type === "artist" ? (
                                <Link to={`/${item.item_type}/${item.item_id}`}>
                                  <img
                                    src={item.image_url}
                                    alt={item.item_name || "List item"}
                                    className="homeListExpandedImage"
                                  />
                                </Link>
                              ) : (
                                <img
                                  src={item.image_url}
                                  alt={item.item_name || "List item"}
                                  className="homeListExpandedImage"
                                />
                              )
                            ) : (
                              <div className="homeListExpandedImage placeholder" />
                            )}
                            <p className="homeListExpandedName">
                              {item.item_name || "Unknown Item"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {isListExpanded || listItems.length > 8 ? (
                      <button
                        type="button"
                        className="listFeedToggleButton"
                        onClick={() => {
                          setExpandedHomeListIds((prev) => ({
                            ...prev,
                            [entry.id]: !prev[entry.id],
                          }));
                        }}
                      >
                        {isListExpanded ? "Collapse" : "Show full list"}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {feedHasMore ? (
          <div className="feedLoadMore">
            <button type="button" onClick={() => void loadMoreFeed()}>
              Load more
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="header">
        <h1>sonica</h1>
        <div className="verticalLineSmall"></div>
        <nav className="topNav">
          <Link
            className={location.pathname === "/" ? "navLink active" : "navLink"}
            to="/"
          >
            Home
          </Link>
          <Link
            className={location.pathname === "/search" ? "navLink active" : "navLink"}
            to="/search"
          >
            Search
          </Link>
          <Link
            className={location.pathname === "/charts" ? "navLink active" : "navLink"}
            to="/charts"
          >
            Charts
          </Link>
          <Link
            className={location.pathname === "/library" ? "navLink active" : "navLink"}
            to="/library"
          >
            Library
          </Link>
        </nav>

        {authUser?.username ? (
          <div className="userMenuTopRight">
            <div className="userMenuTrigger">
              <UserAvatar
                imageUrl={authUser.profile_image_url}
                name={authUser.username}
                className="menuUserAvatar"
              />
              <p className="usernameTopRight">{authUser.username}</p>
            </div>
            <div className="userHoverMenu">
              <button onClick={() => navigate("/settings")}>Profile Settings</button>
              <button onClick={() => navigate("/library")}>View My Lists</button>
              <button onClick={logout}>Logout</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="body">
        <Suspense fallback={<p style={{ padding: "2rem" }}>Loading...</p>}>
          <Routes>
            <Route path="/" element={renderHomePage()} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/charts" element={<ChartsPage />} />
            <Route path="/album/:albumId" element={<AlbumPage />} />
            <Route path="/artist/:artistId" element={<ArtistPage />} />
            <Route path="/user/:username" element={<UserPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        {reviewEditor.open ? (
          <div
            className="reviewModalBackdrop"
            onClick={() => closeReviewEditor()}
          >
            <div
              className="reviewModalCard"
              onClick={(event) => event.stopPropagation()}
            >
              <h3>Review</h3>
              <div className="reviewDotsRow">
                {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                  <button
                    key={score}
                    type="button"
                    className={`reviewDot ${reviewDraft.rating >= score ? "active" : ""}`}
                    onClick={() => {
                      setReviewDraft((prev) => ({ ...prev, rating: score }));
                    }}
                    aria-label={`Rate ${score} out of 10`}
                  >
                    {score}
                  </button>
                ))}
              </div>
              <input
                type="text"
                className="reviewInput"
                placeholder="Review title (optional)"
                value={reviewDraft.title}
                onChange={(event) =>
                  setReviewDraft((prev) => ({ ...prev, title: event.target.value }))
                }
              />
              <textarea
                className="reviewTextarea"
                placeholder="Review text (optional)"
                value={reviewDraft.body}
                onChange={(event) =>
                  setReviewDraft((prev) => ({ ...prev, body: event.target.value }))
                }
              />
              {reviewEditorError ? (
                <p className="authError">{reviewEditorError}</p>
              ) : null}
              <div className="reviewModalActions">
                {reviewEditor.payload &&
                reviewByKey?.[
                  `${reviewEditor.payload.item_type}:${reviewEditor.payload.item_id}`
                ] ? (
                  <button
                    type="button"
                    className="dangerButton"
                    onClick={() => void deleteReviewFromEditor()}
                    disabled={reviewEditorSaving || reviewEditorDeleting}
                  >
                    {reviewEditorDeleting ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void submitReviewEditor()}
                  disabled={reviewEditorSaving || reviewEditorDeleting}
                >
                  {reviewEditorSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={closeReviewEditor}
                  disabled={reviewEditorSaving || reviewEditorDeleting}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <Analytics />
        <SpeedInsights />
      </div>
    </div>
  );
}

export default App;
