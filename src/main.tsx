import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUpRight, Check, CircleUserRound, Lightbulb, LogOut, Plus, Search, Sparkles, X } from "lucide-react";
import { authenticate, loadIdeas, saveIdea } from "./github";
import type { Idea, Status } from "./types";
import "./styles.css";

const statuses: { value: Status; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "developing", label: "Developing" },
  { value: "ready_to_film", label: "Ready to film" },
  { value: "filmed", label: "Filmed" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archive" },
];

const emptyIdea = (): Idea => ({
  schema_version: 1,
  idea_id: "",
  title: "",
  premise: "",
  status: "inbox",
  source: { type: "manual", reference: "Idea Desk" },
  platforms: ["youtube"], content_types: [], tags: [], priority: 3, notes: [],
  related_stream_ids: [], related_topic_ids: [], created_at: "", updated_at: "",
});

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58);
}

function App() {
  const [token, setToken] = useState(sessionStorage.getItem("github-token") ?? "");
  const [draftToken, setDraftToken] = useState("");
  const [user, setUser] = useState<{ login: string; avatar_url: string } | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [active, setActive] = useState<Status>("inbox");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Idea | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn(value = draftToken) {
    setBusy(true); setError("");
    try {
      const account = await authenticate(value.trim());
      if (account.login.toLowerCase() !== "aj47") throw new Error("This desk is restricted to the aj47 GitHub account.");
      const records = await loadIdeas(value.trim());
      sessionStorage.setItem("github-token", value.trim()); setToken(value.trim()); setUser(account); setIdeas(records);
    } catch (err) { setError(err instanceof Error ? err.message : "Authentication failed"); }
    finally { setBusy(false); }
  }

  React.useEffect(() => { if (token && !user) void signIn(token); }, []);

  const visible = useMemo(() => ideas.filter((idea) => {
    const text = `${idea.title} ${idea.premise} ${idea.hook ?? ""} ${idea.tags.join(" ")}`.toLowerCase();
    return idea.status === active && text.includes(query.toLowerCase());
  }).sort((a, b) => b.priority - a.priority || b.updated_at.localeCompare(a.updated_at)), [ideas, active, query]);

  async function persist() {
    if (!editing) return;
    if (!editing.title.trim() || !editing.premise.trim()) { setError("Title and premise are required."); return; }
    setBusy(true); setError("");
    try {
      const now = new Date().toISOString();
      const isNew = !editing.idea_id;
      const finalIdea = { ...editing, idea_id: isNew ? `${now.slice(0, 10)}-${slug(editing.title)}-${now.slice(11, 19).replace(/:/g, "")}` : editing.idea_id, created_at: editing.created_at || now, updated_at: now };
      const next = await saveIdea(token, finalIdea, ideas); setIdeas(next); setEditing(null); setActive(finalIdea.status);
    } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
    finally { setBusy(false); }
  }

  if (!user) return <main className="gate">
    <section className="gate-card">
      <span className="eyebrow"><CircleUserRound size={15}/> PRIVATE GITHUB WORKSPACE</span>
      <h1>Your ideas,<br/><em>finally in one place.</em></h1>
      <p>The interface is public code. Your ideas stay private in <code>aj47/shared-agents</code> and load only after GitHub verifies a session-scoped token.</p>
      <label>Fine-grained GitHub token</label>
      <input type="password" value={draftToken} onChange={(e) => setDraftToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void signIn()} placeholder="github_pat_…" autoComplete="off"/>
      <button className="primary" onClick={() => void signIn()} disabled={busy || !draftToken}>{busy ? "Checking access…" : "Open idea desk"}<ArrowUpRight size={17}/></button>
      <a href="https://github.com/settings/personal-access-tokens/new" target="_blank">Create a token limited to shared-agents <ArrowUpRight size={13}/></a>
      <small>Required permission: Contents — read and write. Stored only in this tab session.</small>
      {error && <div className="error">{error}</div>}
    </section>
  </main>;

  return <div className="app-shell">
    <aside>
      <div className="brand"><Lightbulb/><span>IDEA<br/>DESK</span></div>
      <nav>{statuses.map((status) => <button className={active === status.value ? "active" : ""} onClick={() => setActive(status.value)} key={status.value}><span>{status.label}</span><b>{ideas.filter((idea) => idea.status === status.value).length}</b></button>)}</nav>
      <div className="account"><img src={user.avatar_url}/><div><strong>@{user.login}</strong><span>private repository</span></div><button title="Sign out" onClick={() => { sessionStorage.clear(); location.reload(); }}><LogOut size={16}/></button></div>
    </aside>
    <main className="workspace">
      <header><div><span className="eyebrow">SHARED CREATIVE SYSTEM</span><h1>{statuses.find((s) => s.value === active)?.label}</h1></div><button className="primary" onClick={() => setEditing(emptyIdea())}><Plus size={17}/> Capture idea</button></header>
      <div className="toolbar"><Search size={18}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${ideas.length} ideas…`}/><span>{visible.length} showing</span></div>
      {error && <div className="error inline">{error}<button onClick={() => setError("")}><X size={14}/></button></div>}
      <section className="ideas">
        {visible.map((idea, i) => <article key={idea.idea_id} onClick={() => setEditing(structuredClone(idea))}>
          <div className="rank">{String(i + 1).padStart(2, "0")}</div>
          <div className="idea-copy"><div className="meta"><span className={`priority p${idea.priority}`}>P{idea.priority}</span>{idea.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div><h2>{idea.title}</h2><p>{idea.premise}</p>{idea.hook && <blockquote>“{idea.hook}”</blockquote>}</div>
          <div className="idea-action"><ArrowUpRight/></div>
        </article>)}
        {!visible.length && <div className="empty"><Sparkles/><h2>Nothing here yet.</h2><p>Change the filter or capture the next thing worth making.</p></div>}
      </section>
    </main>
    {editing && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}><section className="editor">
      <header><div><span className="eyebrow">{editing.idea_id ? "EDIT IDEA" : "NEW IDEA"}</span><h2>{editing.idea_id ? "Shape the concept" : "Catch it before it disappears"}</h2></div><button onClick={() => setEditing(null)}><X/></button></header>
      <label>Working title<input value={editing.title} onChange={(e) => setEditing({...editing, title: e.target.value})}/></label>
      <label>Raw premise<textarea rows={5} value={editing.premise} onChange={(e) => setEditing({...editing, premise: e.target.value})}/></label>
      <div className="two"><label>Status<select value={editing.status} onChange={(e) => setEditing({...editing, status: e.target.value as Status})}>{statuses.map((s) => <option value={s.value} key={s.value}>{s.label}</option>)}</select></label><label>Priority<select value={editing.priority} onChange={(e) => setEditing({...editing, priority: Number(e.target.value)})}>{[5,4,3,2,1,0].map((p) => <option value={p} key={p}>P{p}</option>)}</select></label></div>
      <label>Hook<input value={editing.hook ?? ""} onChange={(e) => setEditing({...editing, hook: e.target.value})} placeholder="The first line…"/></label>
      <label>Tags<input value={editing.tags.join(", ")} onChange={(e) => setEditing({...editing, tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean)})} placeholder="codex, workflow, video-editing"/></label>
      <footer><span><Check size={14}/> Saves directly to GitHub history</span><button className="primary" onClick={() => void persist()} disabled={busy}>{busy ? "Committing…" : "Save idea"}</button></footer>
    </section></div>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<App/>);
