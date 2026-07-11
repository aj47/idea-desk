#!/usr/bin/env python3
"""Tailnet-only Idea Desk server backed by a local shared-agents checkout."""

from __future__ import annotations

import fcntl
import json
import os
import re
import subprocess
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

HOST = os.environ.get("IDEA_DESK_HOST", "127.0.0.1")
PORT = int(os.environ.get("IDEA_DESK_PORT", "9132"))
DIST = Path(os.environ.get("IDEA_DESK_DIST", Path(__file__).parent / "dist")).resolve()
DATA_REPO = Path(os.environ["IDEA_DATA_REPO"]).resolve()
ALLOWED_LOGIN = os.environ["IDEA_ALLOWED_TAILSCALE_LOGIN"].casefold()
INDEX = DATA_REPO / "data" / "ideas-index.json"
IDEAS = DATA_REPO / "data" / "ideas"
LOCK = DATA_REPO / ".idea-desk.lock"
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,120}$")
STATUSES = {"inbox", "developing", "ready_to_film", "filmed", "published", "archived"}


def git(*args: str) -> str:
    return subprocess.check_output(["git", "-C", str(DATA_REPO), *args], text=True, stderr=subprocess.STDOUT).strip()


class Handler(SimpleHTTPRequestHandler):
    server_version = "IdeaDesk/1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def identity(self) -> tuple[str, str, str] | None:
        login = self.headers.get("Tailscale-User-Login", "").strip()
        if not login or login.casefold() != ALLOWED_LOGIN:
            return None
        return (
            login,
            self.headers.get("Tailscale-User-Name", login).strip(),
            self.headers.get("Tailscale-User-Profile-Pic", "").strip(),
        )

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def require_identity(self) -> tuple[str, str, str] | None:
        identity = self.identity()
        if identity is None:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"message": "A permitted Tailscale identity is required."})
        return identity

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/session":
            identity = self.require_identity()
            if identity:
                self.send_json(HTTPStatus.OK, {"login": identity[0], "name": identity[1], "avatar_url": identity[2]})
            return
        if path == "/api/ideas":
            if not self.require_identity():
                return
            self.send_json(HTTPStatus.OK, json.loads(INDEX.read_text(encoding="utf-8")))
            return
        super().do_GET()

    def do_PUT(self) -> None:
        path = unquote(urlparse(self.path).path)
        if not path.startswith("/api/ideas/") or not self.require_identity():
            if not path.startswith("/api/ideas/"):
                self.send_json(HTTPStatus.NOT_FOUND, {"message": "Not found"})
            return
        idea_id = path.removeprefix("/api/ideas/")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 256_000:
                raise ValueError("Invalid request size")
            idea = json.loads(self.rfile.read(length))
            if not ID.fullmatch(idea_id) or idea.get("idea_id") != idea_id:
                raise ValueError("Invalid idea ID")
            if not idea.get("title", "").strip() or not idea.get("premise", "").strip():
                raise ValueError("Title and premise are required")
            if idea.get("status") not in STATUSES:
                raise ValueError("Invalid status")
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            return

        try:
            with LOCK.open("w") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                if git("status", "--porcelain"):
                    raise RuntimeError("The shared-agents checkout has uncommitted changes")
                git("pull", "--ff-only", "origin", "main")
                payload = json.loads(INDEX.read_text(encoding="utf-8"))
                records = payload["ideas"]
                records = [idea if entry["idea_id"] == idea_id else entry for entry in records]
                if not any(entry["idea_id"] == idea_id for entry in payload["ideas"]):
                    records.insert(0, idea)
                (IDEAS / f"{idea_id}.json").write_text(json.dumps(idea, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                INDEX.write_text(json.dumps({"schema_version": 1, "ideas": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                git("add", f"data/ideas/{idea_id}.json", "data/ideas-index.json")
                git("commit", "-m", f"Update idea: {idea['title'][:120]}")
                git("push", "origin", "main")
            self.send_json(HTTPStatus.OK, {"ideas": records})
        except (OSError, subprocess.CalledProcessError, RuntimeError) as error:
            self.send_json(HTTPStatus.CONFLICT, {"message": str(error)})


if __name__ == "__main__":
    if not DIST.is_dir() or not INDEX.is_file():
        raise SystemExit("Idea Desk dist or data index is missing")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
