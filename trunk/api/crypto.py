# =============================================================================
# crypto.py — symmetric encryption for personal secrets (personal-data platform)
#
# Encrypts the per-profile connection secrets so a copy of the DB (e.g. one
# replicated/backed-up to a NAS) can't be decrypted on its own. The key lives in
# a HOST keyfile mounted into the API, separate from the DB volume — set its path
# with THRIVE_KEY_FILE (default /keys/connections.key, a small dedicated mount).
# Generated once on first use (0600); back it up alongside the appliance, NOT
# with the database. Uses Fernet (AES-128-CBC + HMAC, authenticated).
# =============================================================================
import os, json
from pathlib import Path
from cryptography.fernet import Fernet

KEY_FILE = os.environ.get("THRIVE_KEY_FILE", "/keys/connections.key")
_fernet = None


def _load_key() -> bytes:
    p = Path(KEY_FILE)
    if p.exists():
        return p.read_bytes().strip()
    key = Fernet.generate_key()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(key)
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass
    return key


def _f() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_key())
    return _fernet


def encrypt(plaintext: str) -> str:
    return _f().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    return _f().decrypt(token.encode()).decode()


# ── module-facing helper: decrypted secret for a (profile, provider) ──────────
# Lives here (a shared platform lib) so ANY module can read a profile's stored
# secret with `from crypto import get_secret`. The Connections *module* owns the
# `connections` table + the CRUD/UI; the secret-read primitive is platform plumbing.
def get_secret(db, profile_id, provider):
    """Decrypted secret dict for one profile's connection to `provider`, or None.
    Server-side only (the secret never crosses the API). Returns None gracefully
    when the Connections module isn't installed (the `connections` table is absent)."""
    try:
        row = db.execute(
            "SELECT secret FROM connections WHERE owner_user_id = ? AND provider = ? ORDER BY id LIMIT 1",
            (profile_id, provider)
        ).fetchone()
    except Exception:
        return None
    return json.loads(decrypt(row["secret"])) if row else None
