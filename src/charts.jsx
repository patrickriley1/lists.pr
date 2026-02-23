import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import "./charts.css";

function ChartsPage({ canUseApp, getCharts }) {
  const [chartType, setChartType] = useState("album");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canUseApp) return;

    setLoading(true);
    setError("");
    setEntries([]);

    getCharts(chartType, 100)
      .then((data) => {
        setEntries(data || []);
      })
      .catch(() => {
        setError("Could not load charts.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [canUseApp, chartType, getCharts]);

  if (!canUseApp) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="chartsPage">
      <h2 className="pageTitle">Charts</h2>

      <div className="chartTabs">
        <button
          type="button"
          className={chartType === "album" ? "active" : ""}
          onClick={() => setChartType("album")}
        >
          Top Albums
        </button>
        <button
          type="button"
          className={chartType === "track" ? "active" : ""}
          onClick={() => setChartType("track")}
        >
          Top Songs
        </button>
        <button
          type="button"
          className={chartType === "artist" ? "active" : ""}
          onClick={() => setChartType("artist")}
        >
          Top Artists
        </button>
      </div>

      {loading ? <p>Loading chart...</p> : null}
      {error ? <p className="authError">{error}</p> : null}

      {!loading && !error ? (
        <div className="chartList">
          {entries.length === 0 ? <p>No ratings yet for this chart.</p> : null}
          {entries.map((entry, index) => (
            <div key={`${entry.item_type}:${entry.item_id}`} className="chartRow">
              <span className="chartRank">{index + 1}</span>
              {entry.image_url ? (
                <img src={entry.image_url} alt={entry.item_name || "Ranked item"} className="chartImage" />
              ) : (
                <div className="chartImage placeholder" />
              )}
              <div className="chartMeta">
                <p className="chartTitle">{entry.item_name || "Unknown Item"}</p>
                <p>{entry.item_subtitle || ""}</p>
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
