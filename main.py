"""
ASGI entry when the process cwd is the repository root (e.g. Render default).

Start: python -m uvicorn main:app --host 0.0.0.0 --port $PORT
"""

from __future__ import annotations

try:
    from backend.main import app
except ModuleNotFoundError as e:  # pragma: no cover
    raise ModuleNotFoundError(
        "Could not import backend.main. Deploy from the repository root (folder that "
        "contains both main.py and the backend/ package), not from inside backend/ alone."
    ) from e

__all__ = ["app"]
