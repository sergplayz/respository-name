"""
ASGI entry when the process cwd is the repository root (e.g. Render default).

Start: python -m uvicorn main:app --host 0.0.0.0 --port $PORT
"""

from __future__ import annotations

try:
    from backend.main import app
except ModuleNotFoundError as e:  # pragma: no cover
    # Do not swallow missing third-party deps (jwt, bcrypt, slowapi, …) from backend.main.
    if getattr(e, "name", None) not in ("backend", "backend.main"):
        raise
    raise ModuleNotFoundError(
        "Could not import backend.main. Use repository root (must include the backend/ "
        "folder), or set Render Root Directory to backend and start with: "
        "python -m uvicorn main:app"
    ) from e

__all__ = ["app"]
