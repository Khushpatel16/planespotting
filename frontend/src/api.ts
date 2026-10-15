import type { AppConfig, Sighting, Stats } from "./types";

// Same-origin in production; Vite proxies these paths to the backend in dev.
const API = "";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  getConfig: () => fetch(`${API}/api/config`).then((r) => json<AppConfig>(r)),

  setFlow: (flow: "west" | "east" | null) =>
    fetch(`${API}/api/flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow }),
    }).then((r) => json<{ flow_override: string | null }>(r)),

  listSightings: () => fetch(`${API}/api/sightings`).then((r) => json<Sighting[]>(r)),

  createSighting: (payload: Partial<Sighting>) =>
    fetch(`${API}/api/sightings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => json<Sighting>(r)),

  uploadPhoto: (id: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${API}/api/sightings/${id}/photo`, { method: "POST", body: fd }).then((r) =>
      json<Sighting>(r),
    );
  },

  deleteSighting: (id: number) =>
    fetch(`${API}/api/sightings/${id}`, { method: "DELETE" }).then((r) =>
      json<{ deleted: number }>(r),
    ),

  getStats: () => fetch(`${API}/api/stats`).then((r) => json<Stats>(r)),

  getPhoto: (hex: string, reg?: string | null) => {
    const q = reg ? `?reg=${encodeURIComponent(reg)}` : "";
    return fetch(`${API}/api/photo/${encodeURIComponent(hex)}${q}`).then((r) =>
      json<AircraftPhoto>(r),
    );
  },
};

export interface AircraftPhoto {
  url: string;
  photographer: string;
  link: string;
}

export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}
