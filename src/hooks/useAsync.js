import { useEffect, useRef, useState } from "react";

/**
 * Run an async function whenever `deps` change.  The function reference itself
 * is stored in a ref so it doesn't need to be in the dep array — only the
 * values that actually drive re-fetching belong there.
 *
 * @template T
 * @param {() => Promise<T>} asyncFn
 * @param {readonly unknown[]} deps
 * @returns {{ data: T|null, loading: boolean, error: string }}
 */
export function useAsync(asyncFn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  const fnRef = useRef(asyncFn);
  fnRef.current = asyncFn;

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: "" });

    fnRef.current()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: "" });
      })
      .catch((err) => {
        if (!cancelled)
          setState({ data: null, loading: false, error: err?.message || "An error occurred" });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
