import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import "./library.css";

function LibraryPage({
  canUseApp,
  userLists,
  setUserLists,
  renameList,
  deleteList,
  reorderListItems,
  removeItemFromList,
  ratingEntries,
  albumMetaById,
}) {
  const [activeListId, setActiveListId] = useState(null);
  const [draggingItemId, setDraggingItemId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editOrderIds, setEditOrderIds] = useState([]);
  const editOrderIdsRef = useRef([]);
  const dragStartOrderRef = useRef([]);

  const activeList = useMemo(
    () => userLists.find((list) => list.id === activeListId) || null,
    [activeListId, userLists]
  );
  const sortedActiveItems = useMemo(
    () => [...(activeList?.items || [])].sort((a, b) => (a.position || 0) - (b.position || 0)),
    [activeList]
  );

  useEffect(() => {
    setIsEditing(false);
    setDraggingItemId(null);
  }, [activeListId]);

  useEffect(() => {
    if (!isEditing) {
      setEditOrderIds([]);
      return;
    }
    setEditOrderIds(sortedActiveItems.map((item) => item.id));
  }, [isEditing, sortedActiveItems]);

  useEffect(() => {
    editOrderIdsRef.current = editOrderIds;
  }, [editOrderIds]);

  async function applyReorderedItems(listId, reorderedItems) {
    setUserLists((prev) => prev.map((entry) => (entry.id === listId ? { ...entry, items: reorderedItems } : entry)));

    await reorderListItems(
      listId,
      reorderedItems.map((entry) => entry.id)
    );
  }

  function reorderIdList(ids, movingId, targetId) {
    const fromIndex = ids.indexOf(movingId);
    const toIndex = ids.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return ids;

    const next = [...ids];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  }

  async function finishPointerReorder(listId, orderedIds) {
    const list = userLists.find((entry) => entry.id === listId);
    if (!list) return;

    const sortedItems = [...(list.items || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
    const byId = new Map(sortedItems.map((entry) => [entry.id, entry]));
    const reorderedItems = orderedIds
      .map((id, index) => {
        const item = byId.get(id);
        if (!item) return null;
        return { ...item, position: index + 1 };
      })
      .filter(Boolean);

    if (reorderedItems.length !== sortedItems.length) return;

    await applyReorderedItems(listId, reorderedItems);
  }

  function startPointerDrag(itemId) {
    if (!isEditing) return;
    dragStartOrderRef.current = editOrderIdsRef.current;
    setDraggingItemId(itemId);
  }

  if (!canUseApp) {
    return <Navigate to="/" replace />;
  }

  const sortedLists = [...userLists].sort((a, b) => a.id - b.id);
  const previewsPerRow = 4;
  const listRows = [];

  for (let index = 0; index < sortedLists.length; index += previewsPerRow) {
    listRows.push(sortedLists.slice(index, index + previewsPerRow));
  }

  useEffect(() => {
    if (!isEditing || !draggingItemId || !activeListId) return;

    function handlePointerMove(event) {
      const targetElement = document.elementFromPoint(event.clientX, event.clientY);
      const row = targetElement?.closest?.("[data-edit-item-id]");
      if (!row) return;

      const targetId = Number(row.getAttribute("data-edit-item-id"));
      if (!targetId || targetId === draggingItemId) return;

      setEditOrderIds((prev) => reorderIdList(prev, draggingItemId, targetId));
    }

    function handlePointerUp() {
      const startOrder = dragStartOrderRef.current;
      const finalOrder = editOrderIdsRef.current;
      const changed =
        startOrder.length === finalOrder.length && startOrder.some((id, index) => id !== finalOrder[index]);

      if (changed) {
        void finishPointerReorder(activeListId, finalOrder);
      }

      setDraggingItemId(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [activeListId, draggingItemId, isEditing, userLists]);

  function renderActiveListPanel() {
    if (!activeList) return null;

    return (
      <div className="myListsPanel">
        <div className="selectedListHeader">
          <h3>{activeList.name}</h3>
          <div className="selectedListActions">
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
                setIsEditing((prev) => !prev);
              }}
            >
              {isEditing ? "Done" : "Edit"}
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
          <div className={isEditing ? "listItemsEditList" : "listItemsGrid"}>
            {(isEditing
              ? editOrderIds
                  .map((id) => sortedActiveItems.find((entry) => entry.id === id))
                  .filter(Boolean)
              : sortedActiveItems
            )
              .map((item, index) => (
                isEditing ? (
                  <div
                    key={item.id}
                    className={`editListRow ${draggingItemId === item.id ? "dragging" : ""}`}
                    data-edit-item-id={item.id}
                  >
                    <span className="listItemPosition">{index + 1}</span>
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.item_name}
                        className="editListThumb"
                        draggable={false}
                      />
                    ) : (
                      <div className="editListThumb placeholder" />
                    )}
                    <p className="editListItemName">{item.item_name}</p>
                    <div className="editListRight">
                      <button
                        type="button"
                        className="dragHandleButton"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          startPointerDrag(item.id);
                        }}
                        aria-label={`Reorder ${item.item_name}`}
                        title="Drag to reorder"
                      >
                        ≡
                      </button>
                      <button
                        type="button"
                        className="removeRowButton"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void removeItemFromList(activeList.id, item.id);
                        }}
                        aria-label={`Remove ${item.item_name} from ${activeList.name}`}
                        title="Remove from list"
                      >
                        -
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={item.id} className="myListItem listItemCard readonly">
                    <span className="listItemPosition">{index + 1}</span>
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.item_name}
                        className="listItemImage"
                        draggable={false}
                      />
                    ) : (
                      <div className="listItemImage placeholder" />
                    )}
                    <p>{item.item_name}</p>
                  </div>
                )
              ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="libraryPage">
      <h2 className="pageTitle">Library</h2>

      <div className="libraryGrid">
        <div className="libraryColumn listsColumn">
          <h3>My Lists</h3>

          <div className="listPreviewRows">
            {listRows.map((row, rowIndex) => {
              const rowHasActiveList = row.some((list) => list.id === activeListId);

              return (
                <div key={`preview-row-${rowIndex}`} className="listPreviewRowBlock">
                  <div className="listPreviewGrid">
                    {row.map((list) => {
                      const previewItems = [...(list.items || [])]
                        .sort((a, b) => (a.position || 0) - (b.position || 0))
                        .slice(0, 4);

                      return (
                        <button
                          type="button"
                          key={list.id}
                          className={`listPreviewCard ${activeListId === list.id ? "active" : ""}`}
                          onClick={() =>
                            list.id === activeListId ? setActiveListId(null) : setActiveListId(list.id)
                          }
                        >
                          <div className="listPreviewHeader">
                            <p className="listPreviewTitle">{list.name}</p>
                          </div>
                          <div className="listPreviewImages">
                            {[0, 1, 2, 3].map((slot) => {
                              const previewItem = previewItems[slot];
                              return previewItem?.image_url ? (
                                <img
                                  key={slot}
                                  src={previewItem.image_url}
                                  alt={previewItem.item_name}
                                  draggable={false}
                                />
                              ) : (
                                <div key={slot} className="previewPlaceholder" />
                              );
                            })}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {rowHasActiveList ? renderActiveListPanel() : null}
                </div>
              );
            })}
          </div>
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
                    <p>Rating: {entry.rating}</p>
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
