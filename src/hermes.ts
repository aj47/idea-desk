import type { Idea } from "./types";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(`${response.status}: ${body.message ?? response.statusText}`);
  }
  return response.json();
}

export async function hermesSession() {
  return json<{ login: string; name: string; avatar_url: string }>("/api/session");
}

export async function loadHermesIdeas() {
  return (await json<{ ideas: Idea[] }>("/api/ideas")).ideas;
}

export async function saveHermesIdea(idea: Idea) {
  return (await json<{ ideas: Idea[] }>(`/api/ideas/${encodeURIComponent(idea.idea_id)}`, {
    method: "PUT",
    body: JSON.stringify(idea),
  })).ideas;
}
