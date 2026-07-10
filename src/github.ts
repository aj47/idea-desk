import type { Idea } from "./types";

const OWNER = "aj47";
const REPO = "shared-agents";
const BRANCH = "main";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`${response.status}: ${(await response.json()).message ?? response.statusText}`);
  return response.json();
}

function decodeBase64(value: string) {
  const bytes = Uint8Array.from(atob(value.replace(/\n/g, "")), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

export async function authenticate(token: string) {
  const user = await request<{ login: string; avatar_url: string }>(token, "https://api.github.com/user");
  await request(token, "");
  return user;
}

export async function loadIdeas(token: string): Promise<Idea[]> {
  const file = await request<{ content: string }>(token, "/contents/data/ideas-index.json?ref=main");
  return (JSON.parse(decodeBase64(file.content)) as { ideas: Idea[] }).ideas;
}

export async function saveIdea(token: string, idea: Idea, allIdeas: Idea[]) {
  const ref = await request<{ object: { sha: string } }>(token, `/git/ref/heads/${BRANCH}`);
  const commit = await request<{ tree: { sha: string } }>(token, `/git/commits/${ref.object.sha}`);
  const updated = allIdeas.some((entry) => entry.idea_id === idea.idea_id)
    ? allIdeas.map((entry) => (entry.idea_id === idea.idea_id ? idea : entry))
    : [idea, ...allIdeas];
  const [ideaBlob, indexBlob] = await Promise.all([
    request<{ sha: string }>(token, "/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: encodeBase64(JSON.stringify(idea, null, 2) + "\n"), encoding: "base64" }),
    }),
    request<{ sha: string }>(token, "/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: encodeBase64(JSON.stringify({ schema_version: 1, ideas: updated }, null, 2) + "\n"), encoding: "base64" }),
    }),
  ]);
  const tree = await request<{ sha: string }>(token, "/git/trees", {
    method: "POST",
    body: JSON.stringify({
      base_tree: commit.tree.sha,
      tree: [
        { path: `data/ideas/${idea.idea_id}.json`, mode: "100644", type: "blob", sha: ideaBlob.sha },
        { path: "data/ideas-index.json", mode: "100644", type: "blob", sha: indexBlob.sha },
      ],
    }),
  });
  const next = await request<{ sha: string }>(token, "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message: `Update idea: ${idea.title}`, tree: tree.sha, parents: [ref.object.sha] }),
  });
  await request(token, `/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: next.sha, force: false }),
  });
  return updated;
}
