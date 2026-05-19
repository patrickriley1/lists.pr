import { Navigate, useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "./context/AuthContext";
import { useData } from "./context/DataContext";
import { useAsync } from "./hooks/useAsync";
import ArtistLinks from "./artist-links";
import "./charts.css";

function ChartsPage() {
  const navigate = useNavigate();
  const { canUseApp } = useAuth();
  const { getCharts } = useData();
  const [chartType, setChartType] = useState("album");

  const {
    data: entries,
    loading,
    error,
  } = useAsync(() => (canUseApp ? getCharts(chartType, 100) : Promise.resolve([])), [
    canUseApp,
    chartType,
  ]);

  if (!canUseApp) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="chartsPage">
      <h2 className="pageTitle">Charts</h2>

      <div className="chartTabs">
        {["album", "track", "artist"].map((type) => (
          <button
            key={type}
            type="button"
            className={chartType === type ? "active" : ""}
            onClick={() => setChartType(type)}
          >
            {type === "album" ? "Top Albums" : type === "track" ? "Top Songs" : "Top Artists"}
          </button>
        ))}
      </div>

      {loading ? <p>Loading chart...</p> : null}
      {error ? <p className="authError">{error}</p> : null}

      {!loading && !error ? (
        <div className="chartList">
          {(entries || []).length === 0 ? (
            <p>No ratings yet for this chart.</p>
          ) : null}
          {(entries || []).map((entry, index) => (
            <div
              key={`${entry.item_type}:${entry.item_id}`}
              className="chartRow"
              onClick={() => {
                if (entry.item_type === "album") navigate(`/album/${entry.item_id}`);
                if (entry.item_type === "artist") navigate(`/artist/${entry.item_id}`);
              }}
            >
              <span className="chartRank">{index + 1}</span>
              {entry.image_url ? (
                <img
                  src={entry.image_url}
                  alt={entry.item_name || "Ranked item"}
                  className="chartImage"
                />
              ) : (
                <div className="chartImage placeholder" />
              )}
              <div className="chartMeta">
                {entry.item_type === "artist" ? (
                  <p className="chartTitle">
                    <Link
                      to={`/artist/${entry.item_id}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {entry.item_name || "Unknown Item"}
                    </Link>
                  </p>
                ) : entry.item_type === "album" ? (
                  <p className="chartTitle">
                    <Link
                      to={`/album/${entry.item_id}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {entry.item_name || "Unknown Item"}
                    </Link>
                  </p>
                ) : (
                  <p className="chartTitle">{entry.item_name || "Unknown Item"}</p>
                )}
                <p>
                  {entry.item_type === "artist" ? (
                    entry.item_subtitle || ""
                  ) : (
                    <ArtistLinks text={entry.item_subtitle || ""} />
                  )}
                </p>
              </div>
              <div className="chartScore">
                <p>{entry.average_rating}/10</p>
                <p className="chartVotes">{entry.rating_count} ratings</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ChartsPage;
