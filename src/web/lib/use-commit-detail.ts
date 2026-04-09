import { useEffect, useState } from "react";
import type { CommitDetail } from "@shared/types";
import { api } from "./api";

export function useCommitDetail(sha: string | null): {
  detail: CommitDetail | null;
  loading: boolean;
} {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sha) {
      // Early-return also has to clear loading — otherwise sha → null while
      // a fetch is in-flight leaves the previous effect's `setLoading(true)`
      // stuck: its finally is gated by !cancelled, which the cleanup just set.
      setDetail(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api
      .commit(sha)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sha]);

  return { detail, loading };
}
