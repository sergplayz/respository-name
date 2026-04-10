from __future__ import annotations

import os
import re
import sqlite3
import time
from collections import defaultdict
from secrets import compare_digest
from functools import lru_cache
from pathlib import Path

import bcrypt
import jwt
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "database.sqlite"
_env_db = os.environ.get("MATCOM_DB", "").strip()
DB_PATH = Path(_env_db).resolve() if _env_db else DEFAULT_DB.resolve()

app = FastAPI(title="MATCOM Database Lookup")

security_bearer = HTTPBearer(auto_error=False)


_login_attempts: dict[str, list[float]] = defaultdict(list)


def check_admin_login_rate(request: Request) -> None:
    """In-memory limit for POST /api/admin/login (slowapi conflicts with JSON body on this route)."""
    ip = client_ip(request)
    now = time.time()
    window = 60.0
    max_n = 10
    bucket = _login_attempts[ip]
    bucket[:] = [t for t in bucket if now - t < window]
    if len(bucket) >= max_n:
        raise HTTPException(status_code=429, detail="Too many login attempts; try again later")
    bucket.append(now)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


limiter = Limiter(key_func=client_ip)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


def _cors_settings() -> tuple[list[str], bool]:
    """CORS_ORIGINS: comma-separated URLs, or * for any origin (no credentials)."""
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if raw == "*":
        return ["*"], False
    if raw:
        origins = [o.strip() for o in raw.split(",") if o.strip()]
        if origins:
            return origins, True
    return ["http://127.0.0.1:5173", "http://localhost:5173"], True


_origins, _creds = _cors_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_creds,
    allow_methods=["*"],
    allow_headers=["*"],
)


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def get_connection() -> sqlite3.Connection:
    if not DB_PATH.is_file():
        raise HTTPException(status_code=500, detail="Database file not found")
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def _db_cache_key() -> tuple[float, int]:
    try:
        st = DB_PATH.stat()
        return (float(st.st_mtime_ns), int(st.st_ino))
    except OSError:
        return (-1.0, -1)


@lru_cache(maxsize=32)
def _allowed_tables_cached(_mtime_ns: float, _ino: int) -> frozenset[str]:
    con = sqlite3.connect(DB_PATH)
    try:
        rows = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        return frozenset(r[0] for r in rows)
    finally:
        con.close()


def allowed_tables() -> frozenset[str]:
    return _allowed_tables_cached(*_db_cache_key())


def _public_table_denylist() -> frozenset[str]:
    """Optional comma-separated table names excluded from public API (list/search/rows)."""
    raw = os.environ.get("MATCOM_PUBLIC_TABLE_DENYLIST", "").strip()
    if not raw:
        return frozenset()
    return frozenset(x.strip() for x in raw.split(",") if x.strip())


def public_allowed_tables() -> frozenset[str]:
    deny = _public_table_denylist()
    if not deny:
        return allowed_tables()
    return frozenset(t for t in allowed_tables() if t not in deny)


def validate_table_path_param(name: str) -> None:
    if "\x00" in name or len(name) > 200:
        raise HTTPException(status_code=400, detail="Invalid table name")


def sanitize_search_q(raw: str) -> str:
    s = raw.strip()
    if not s or "\x00" in s:
        raise HTTPException(status_code=400, detail="Invalid search text")
    return s


def table_columns(con: sqlite3.Connection, table: str) -> list[dict]:
    cur = con.execute(f"PRAGMA table_info({quote_ident(table)})")
    out = []
    for cid, name, col_type, notnull, default, pk in cur.fetchall():
        out.append(
            {
                "cid": cid,
                "name": name,
                "type": col_type or "TEXT",
                "pk": bool(pk),
            }
        )
    return out


def human_label(table: str) -> str:
    return table.replace("_", " ").strip().title()


# SQLite column names from spreadsheet export. "Unnamed: N" are filler names for columns
# that had no header text in row 1 (e.g. link-only columns in the sheet). The export
# merged real fields; first column is the padded sheet title cell but holds User rows.
#
# The personnel roster (white layout) uses real header row semantics; we map those below.
# Other tabs often put a title in row 1, so pandas leaves blanks → Unnamed:*. For those
# sheets we add either exact-name maps or COLUMN_DISPLAY_BY_CID (labels by column order).
_PERSONNEL_SHEET_COL_A = "                  United States Space Force Materiel Command Database"
_CERT_BOARD_COL_A = "                  USSF MMATCOM Database"
# Sheet typo: double space after "United" in this tab.
_PROGRESS_ROSTER_COL_A = "                  United  States Space Force Materiel Command Database"
_USSF_MATCOM_DB = "USSF MATCOM Database"

# Maps table name -> sqlite column name -> human-readable label (from roster layout).
COLUMN_DISPLAY_LABELS: dict[str, dict[str, str]] = {
    "personnel_database": {
        _PERSONNEL_SHEET_COL_A: "User (Operating Number)",
        "Unnamed: 1": "SGC Rank",
        "Unnamed: 2": "MATCOM Rank",
        "Unnamed: 3": "Position",
        "Unnamed: 4": "Join Date",
        "Unnamed: 5": "Timezone",
        "Unnamed: 6": "Warnings",
        "Unnamed: 7": "Warn End",
        "Unnamed: 8": "Status",
        "Unnamed: 9": "Date",
        "Unnamed: 10": "Reason",
    },
    "old_personnel_database": {
        _PERSONNEL_SHEET_COL_A: "User (Operating Number)",
        "Unnamed: 1": "SGC Rank",
        "Unnamed: 2": "MATCOM Rank",
        "Unnamed: 3": "Position",
        "Unnamed: 4": "Join Date",
        "Unnamed: 5": "Timezone",
        "Unnamed: 6": "Warnings",
        "Unnamed: 7": "Status",
        "Unnamed: 8": "Date",
        "Unnamed: 9": "Reason",
    },
    "ref": {
        "Unnamed: 0": "User",
        "Unnamed: 1": "MATCOM Rank",
        "Unnamed: 2": "Weekly SL",
        "Unnamed: 3": "Total SL",
        "Unnamed: 4": "Weekly HL",
        "Unnamed: 5": "EL",
        "Unnamed: 6": "ML",
        "Unnamed: 7": "MP",
        "Unnamed: 8": "SR",
        "Unnamed: 9": "EVAC",
        "Unnamed: 10": "C",
        "Unnamed: 11": "ORT",
        "Unnamed: 12": "BGT",
        "Unnamed: 13": "BGT Cooldown",
        "Unnamed: 14": "Deadline",
    },
    "certification_board": {
        _CERT_BOARD_COL_A: "User",
        "Unnamed: 1": "Base Control (auto)",
        "Unnamed: 2": "Stargate Control",
        "Unnamed: 3": "MALP",
        "Unnamed: 4": "Engineering",
        "Unnamed: 5": "Notes / Suspensions",
    },
    "progress_roster": {
        _PROGRESS_ROSTER_COL_A: "User",
        "Unnamed: 1": "Status",
        "Unnamed: 2": "Quota",
        "Unnamed: 3": "SL (Weekly)",
        "Unnamed: 4": "SL (Total)",
        "Unnamed: 5": "HL (Weekly)",
        "Unnamed: 6": "EL",
        "Unnamed: 7": "ML",
        "Unnamed: 8": "MP",
        "Unnamed: 9": "SR",
        "Unnamed: 10": "EVAC",
        "Unnamed: 11": "C",
        "Unnamed: 12": "Streak",
        "Unnamed: 13": "Streak End",
    },
    "discharge_roster": {
        _USSF_MATCOM_DB: "Section / title",
        "Unnamed: 1": "Date",
        "Unnamed: 2": "Username",
        "Unnamed: 3": "Position",
        "Unnamed: 4": "Type of discharge",
        "Unnamed: 5": "Reason",
        "Unnamed: 6": "Spacer",
        "Unnamed: 7": "Approved by",
        "Unnamed: 8": "—",
        "Unnamed: 9": "Date (honorable block)",
        "Unnamed: 10": "Username (honorable block)",
    },
}
COLUMN_DISPLAY_LABELS["discharge"] = COLUMN_DISPLAY_LABELS["discharge_roster"]

# When row-1 names are wrong but column order matches the sheet body (e.g. discharge tab).
_DISCHARGE_ROSTER_CID_LABELS = [
    "Section / title",
    "Date",
    "Username",
    "Position",
    "Type of discharge",
    "Reason",
    "Spacer",
    "Approved by",
    "—",
    "Date (honorable block)",
    "Username (honorable block)",
]

COLUMN_DISPLAY_BY_CID: dict[str, list[str]] = {
    "discharge_roster": _DISCHARGE_ROSTER_CID_LABELS,
    # Alternate sqlite names from some import scripts
    "discharge": _DISCHARGE_ROSTER_CID_LABELS,
}

_UNNAMED_COL_RE = re.compile(r"^Unnamed:(\d+)$")


def enrich_columns(table: str, columns: list[dict]) -> list[dict]:
    name_overrides = COLUMN_DISPLAY_LABELS.get(table)
    cid_labels = COLUMN_DISPLAY_BY_CID.get(table)
    out: list[dict] = []
    for col in columns:
        c = dict(col)
        name = col["name"]
        cid = col["cid"]
        display: str | None = None
        if name_overrides and name in name_overrides:
            display = name_overrides[name]
        elif cid_labels is not None and cid < len(cid_labels) and cid_labels[cid].strip():
            display = cid_labels[cid]
        elif m := _UNNAMED_COL_RE.match(name):
            display = f"Field {int(m.group(1)) + 1}"
        if display is not None:
            c["displayName"] = display
        out.append(c)
    return out


# --- Admin auth ---
# Required: MATCOM_ADMIN_USERNAME, MATCOM_JWT_SECRET (≥16 chars).
# Password: MATCOM_ADMIN_PASSWORD_BCRYPT (preferred) or MATCOM_ADMIN_PASSWORD (plain; use Render “Secret” type).


def _admin_env_checks() -> dict[str, bool]:
    """Which pieces exist (no values exposed). Use to debug Render env."""
    user = os.environ.get("MATCOM_ADMIN_USERNAME", "").strip()
    secret = os.environ.get("MATCOM_JWT_SECRET", "").strip()
    pw_hash = os.environ.get("MATCOM_ADMIN_PASSWORD_BCRYPT", "").strip()
    pw_plain = os.environ.get("MATCOM_ADMIN_PASSWORD", "").strip()
    return {
        "has_username": bool(user),
        "has_jwt_secret": bool(secret),
        "jwt_secret_at_least_16_chars": len(secret) >= 16,
        "has_password_plain_or_bcrypt": bool(pw_hash) or bool(pw_plain),
    }


def _admin_settings() -> tuple[str, str, str | None, str | None] | None:
    """(username, jwt_secret, bcrypt_hash_or_none, plain_password_or_none)."""
    user = os.environ.get("MATCOM_ADMIN_USERNAME", "").strip()
    secret = os.environ.get("MATCOM_JWT_SECRET", "").strip()
    pw_hash = os.environ.get("MATCOM_ADMIN_PASSWORD_BCRYPT", "").strip() or None
    pw_plain = os.environ.get("MATCOM_ADMIN_PASSWORD", "").strip() or None
    if not user or not secret or len(secret) < 16:
        return None
    if not pw_hash and not pw_plain:
        return None
    if pw_hash:
        pw_plain = None
    return user, secret, pw_hash, pw_plain


def _verify_admin_password_bcrypt(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _password_ok(plain: str, pw_hash: str | None, pw_plain: str | None) -> bool:
    if pw_hash:
        return _verify_admin_password_bcrypt(plain, pw_hash)
    if pw_plain is not None:
        return compare_digest(plain.encode("utf-8"), pw_plain.encode("utf-8"))
    return False


def _mint_jwt(username: str, secret: str) -> str:
    now = int(time.time())
    payload = {"sub": username, "iat": now, "exp": now + 7 * 24 * 3600}
    return jwt.encode(payload, secret, algorithm="HS256")


def _decode_jwt(token: str, secret: str) -> str | None:
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        sub = payload.get("sub")
        return str(sub) if sub is not None else None
    except jwt.PyJWTError:
        return None


class AdminLoginBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)


def _admin_not_configured_detail() -> dict:
    return {
        "message": "Admin authentication is not configured on the server",
        "checks": _admin_env_checks(),
        "hint": "Set variables on the Render Python service (not Vercel). Use the same environment (Production vs Preview) as your live URL. Save, then Manual Deploy.",
    }


def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_bearer),
) -> str:
    settings = _admin_settings()
    if not settings:
        raise HTTPException(status_code=503, detail=_admin_not_configured_detail())
    _expected_user, secret, _pw_hash, _pw_plain = settings
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing or invalid authorization")
    sub = _decode_jwt(credentials.credentials.strip(), secret)
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return sub


@app.get("/")
@limiter.limit("300/minute")
def root(request: Request):
    """So load balancers / Render health probes that hit `/` get 200, not 404."""
    return {"status": "ok", "service": "matcom-api"}


@app.get("/api/health")
@limiter.limit("300/minute")
def health(request: Request):
    """Cheap liveness probe: no filesystem or DB access (avoids slow I/O on cold mounts)."""
    return {"ok": True}


@app.get("/api/health/admin-auth")
@limiter.limit("60/minute")
def health_admin_auth(request: Request):
    """Shows which admin env vars are present (no secrets). Open on Render to verify configuration."""
    checks = _admin_env_checks()
    ready = (
        checks["has_username"]
        and checks["has_jwt_secret"]
        and checks["jwt_secret_at_least_16_chars"]
        and checks["has_password_plain_or_bcrypt"]
    )
    return {"ready": ready, "checks": checks}


@app.post("/api/admin/login")
def admin_login(request: Request, payload: AdminLoginBody):
    check_admin_login_rate(request)
    settings = _admin_settings()
    if not settings:
        raise HTTPException(status_code=503, detail=_admin_not_configured_detail())
    expected_user, secret, pw_hash, pw_plain = settings
    if payload.username != expected_user or not _password_ok(payload.password, pw_hash, pw_plain):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = _mint_jwt(expected_user, secret)
    return {"access_token": token, "token_type": "bearer", "expires_in": 7 * 24 * 3600}


@app.get("/api/admin/db-status")
@limiter.limit("120/minute")
def admin_db_status(request: Request, _admin: str = Depends(require_admin)):
    """Authenticated summary only: no filesystem paths exposed."""
    ok = DB_PATH.is_file()
    return {"ok": True, "database_reachable": ok}


@app.get("/api/tables")
@limiter.limit("120/minute")
def list_tables(request: Request):
    if not DB_PATH.is_file():
        raise HTTPException(status_code=500, detail="Database file not found")
    con = get_connection()
    try:
        names = sorted(public_allowed_tables())
        result = []
        for name in names:
            cols = enrich_columns(name, table_columns(con, name))
            n = con.execute(f"SELECT COUNT(*) AS c FROM {quote_ident(name)}").fetchone()["c"]
            result.append(
                {
                    "name": name,
                    "label": human_label(name),
                    "rowCount": n,
                    "columns": cols,
                }
            )
        return {"tables": result}
    finally:
        con.close()


@app.get("/api/tables/{table_name}/rows")
@limiter.limit("90/minute")
def table_rows(
    request: Request,
    table_name: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    q: str | None = Query(None, max_length=500),
):
    validate_table_path_param(table_name)
    tables = public_allowed_tables()
    if table_name not in tables:
        raise HTTPException(status_code=404, detail="Unknown table")

    con = get_connection()
    try:
        cols = enrich_columns(table_name, table_columns(con, table_name))
        col_names = [c["name"] for c in cols]
        if not col_names:
            return {"columns": [], "rows": [], "total": 0}

        tq = quote_ident(table_name)
        select_list = ", ".join(quote_ident(c) for c in col_names)

        params: list = []
        where_clause = ""
        if q is not None and q.strip():
            term = f"%{sanitize_search_q(q)}%"
            parts = [
                f"COALESCE(CAST({quote_ident(c)} AS TEXT), '') LIKE ? COLLATE NOCASE"
                for c in col_names
            ]
            where_clause = " WHERE (" + " OR ".join(parts) + ")"
            params.extend([term] * len(col_names))

        count_sql = f"SELECT COUNT(*) AS c FROM {tq}{where_clause}"
        total = con.execute(count_sql, params).fetchone()["c"]

        data_sql = (
            f"SELECT {select_list} FROM {tq}{where_clause} "
            f"LIMIT ? OFFSET ?"
        )
        data_params = [*params, limit, skip]
        cur = con.execute(data_sql, data_params)
        rows = [dict(cur_row) for cur_row in cur.fetchall()]

        return {
            "table": table_name,
            "columns": cols,
            "rows": rows,
            "total": total,
            "skip": skip,
            "limit": limit,
        }
    finally:
        con.close()


@app.get("/api/search")
@limiter.limit("60/minute")
def search_all(
    request: Request,
    q: str = Query(..., min_length=1, max_length=500),
    per_table: int = Query(8, ge=1, le=50),
):
    """Return up to `per_table` matching rows from each table (for quick global lookup)."""
    if not DB_PATH.is_file():
        raise HTTPException(status_code=500, detail="Database file not found")

    term = f"%{sanitize_search_q(q)}%"
    con = get_connection()
    try:
        hits: list[dict] = []
        for name in sorted(public_allowed_tables()):
            cols = enrich_columns(name, table_columns(con, name))
            col_names = [c["name"] for c in cols]
            if not col_names:
                continue
            tq = quote_ident(name)
            select_list = ", ".join(quote_ident(c) for c in col_names)
            parts = [
                f"COALESCE(CAST({quote_ident(c)} AS TEXT), '') LIKE ? COLLATE NOCASE"
                for c in col_names
            ]
            where_clause = " WHERE (" + " OR ".join(parts) + ")"
            params = [term] * len(col_names)
            sql = f"SELECT {select_list} FROM {tq}{where_clause} LIMIT ?"
            cur = con.execute(sql, [*params, per_table])
            batch = [dict(r) for r in cur.fetchall()]
            if batch:
                hits.append(
                    {
                        "table": name,
                        "label": human_label(name),
                        "rows": batch,
                        "columns": cols,
                    }
                )
        return {"query": q.strip(), "hits": hits}
    finally:
        con.close()
