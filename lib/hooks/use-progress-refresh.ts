"use client";

import { useEffect, useRef } from "react";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";

// Keep detail pages in place while compact progress drives selective refreshes.
export function useProgressRefresh(queryKey: QueryKey, revision?: string) {
  const client = useQueryClient();
  const previous = useRef<string | undefined>(undefined);
  const key = JSON.stringify(queryKey);
  useEffect(() => {
    if (revision && previous.current && revision !== previous.current) {
      void client.invalidateQueries({ queryKey: JSON.parse(key) as QueryKey });
    }
    previous.current = revision;
  }, [client, key, revision]);
}
