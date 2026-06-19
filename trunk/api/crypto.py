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
import os
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
