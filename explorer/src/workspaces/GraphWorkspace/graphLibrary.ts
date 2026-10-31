import { useQuery } from "@tanstack/react-query";

export type GraphLibraryEntry = {
  id: string;
  name: string;
  node_count: number;
  edge_count: number;
  created_at: string;
  updated_at: string;
  active: boolean;
};

export type GraphLibraryListing = {
  active_id: string | null;
  graphs: GraphLibraryEntry[];
};

export const GRAPH_LIBRARY_QUERY_KEY = ["graphs", "library"] as const;

export async function requestGraphLibrary<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // Non-JSON error bodies keep the status code as the message.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export function useGraphLibrary() {
  return useQuery<GraphLibraryListing>({
    queryKey: GRAPH_LIBRARY_QUERY_KEY,
    queryFn: () => requestGraphLibrary<GraphLibraryListing>("/api/graphs"),
    staleTime: 5_000,
  });
}
