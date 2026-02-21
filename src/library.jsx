import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";

function LibraryPage({
  canUseApp,
  userLists,
  setUserLists,
  renameList,
  deleteList,
  reorderListItems,
  ratingEntries,
  albumMetaById,
}) {
  const [activeListId, setActiveListId] = useState(null);
  const [draggingItemId, setDraggingItemId] = useState(null);

  const activeList = useMemo(
    () => userLists.find((list) => list.id === activeListId) || null,
    [activeListId, userLists]
  );

  async function moveListItemByDrag(listId, targetItemId) {
    if (!draggingItemId || draggingItemId === targetItemId) return;

    const list = userLists.find((entry) => entry.id === listId);
    if (!list) return;

    const sortedItems = [...(list.items || [])].sort((a, b) => (a.position || 0) - (b.position || 0));

    const fromIndex = sortedItems.findIndex((entry) => entry.id === draggingItemId);
    const toIndex = sortedItems.findIndex((entry) => entry.id === targetItemId);
    if (fromIndex < 0 || toIndex < 0) return;

    const [movedItem] = sortedItems.splice(fromIndex, 1);
    sortedItems.splice(toIndex, 0, movedItem);

    const rePositioned = sortedItems.map((entry, positionIndex) => ({
      ...entry,
      position: positionIndex + 1,
    }));

    setUserLists((prev) =>
      prev.map((entry) => (entry.id === listId ? { ...entry, items: rePositioned } : entry))
    );

    void reorderListItems(
      listId,
      rePositioned.map((entry) => entry.id)
    );

    setDraggingItemId(null);
  }

  if (!canUseApp) {
    return <Navigate to="/" replace />;
  }

  const sortedLists = [...userLists].sort((a, b) => a.id - b.id);

  return (
    <div className="libraryPage">
      <h2 className="pageTitle">Library</h2>

      <div className="libraryGrid">
        <div className="libraryColumn listsColumn">
          <h3>My Lists</h3>

          <div className="listPreviewGrid">
            {sortedLists.map((list) => {
              const previewItems = [...(list.items || [])]
                .sort((a, b) => (a.position || 0) - (b.position || 0))
                .slice(0, 4);

              return (
                <button
                  type="button"
                  key={list.id}
                  className={`listPreviewCard ${activeListId === list.id ? "active" : ""}`}
                  onClick={() => (list.id === activeListId ? setActiveListId(null) : setActiveListId(list.id))}
                >
                  <div className="listPreviewHeader">
                    <p className="listPreviewTitle">{list.name}</p>
                  </div>
                  <div className="listPreviewImages">
                    {[0, 1, 2, 3].map((slot) => {
                      const previewItem = previewItems[slot];
                      return previewItem?.image_url ? (
                        <img key={slot} src={previewItem.image_url} alt={previewItem.item_name} />
                      ) : (
                        <div key={slot} className="previewPlaceholder" />
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          {activeList ? (
            <div className="myListsPanel">
              <div className="selectedListHeader">
                <h3>{activeList.name}</h3>
                <div className="selectedListActions">
                  <button type="button" onClick={() => setActiveListId(null)}>
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void renameList(activeList.id);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void deleteList(activeList.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {(activeList.items || []).length === 0 ? (
                <p>No items in this list yet.</p>
              ) : (
                <div className="listItemsGrid">
                  {[...(activeList.items || [])]
                    .sort((a, b) => (a.position || 0) - (b.position || 0))
                    .map((item, index) => (
                      <div
                        key={item.id}
                        className={`myListItem listItemCard ${draggingItemId === item.id ? "dragging" : ""}`}
                        draggable
                        onDragStart={() => setDraggingItemId(item.id)}
                        onDragOver={(event) => {
                          event.preventDefault();
                        }}
                        onDrop={() => {
                          void moveListItemByDrag(activeList.id, item.id);
                        }}
                        onDragEnd={() => setDraggingItemId(null)}
                      >
                        <span className="listItemPosition">{index + 1}</span>
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.item_name} className="listItemImage" />
                        ) : (
                          <div className="listItemImage placeholder" />
                        )}
                        <p>{item.item_name}</p>
                        <p>{item.item_subtitle}</p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="libraryColumn reviewsColumn">
          <div className="myListsPanel">
            <h3>My Reviews</h3>
            {ratingEntries.length === 0 ? (
              <p>No ratings yet.</p>
            ) : (
              <div className="myListItems">
                {ratingEntries.map((entry) => (
                  <div key={`${entry.album_id}-${entry.rating}`} className="myListItem">
                    <p>{albumMetaById[entry.album_id]?.name || "Loading album..."}</p>
                    <p>{albumMetaById[entry.album_id]?.artists || "Loading artist..."}</p>
                    <p>Rating: {entry.rating}/10</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LibraryPage;
