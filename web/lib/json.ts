"use client";

import { useCallback, useEffect, useState } from "react";

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

/** Shared transport only: singles and doubles retain their own payload schemas. */
export function fetchJson<T>(url: string): Promise<T> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) as T);
  if (!inflight.has(url)) {
    inflight.set(url, fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const data = await response.json();
      cache.set(url, data);
      return data;
    }).finally(() => inflight.delete(url)));
  }
  return inflight.get(url) as Promise<T>;
}

export function useJson<T>(url: string | null) {
  const [result, setResult] = useState<{ url: string | null; data: T | null; error: string | null }>({
    url: null, data: null, error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setResult({ url, data: null, error: null });
    setAttempt((value) => value + 1);
  }, [url]);

  useEffect(() => {
    if (!url) return;
    let active = true;
    fetchJson<T>(url).then(
      (data) => active && setResult({ url, data, error: null }),
      (error) => active && setResult({ url, data: null, error: String(error) }),
    );
    return () => { active = false; };
  }, [url, attempt]);

  // Never present the previous rally's tracks under the new rally's video/header.
  const data = url && cache.has(url) ? cache.get(url) as T : result.url === url ? result.data : null;
  const error = result.url === url ? result.error : null;
  return { data, error, retry };
}
