# thrive

A modular self-hosted household/lifestyle app.

- `core/` — the platform shell: auth, settings, and the module loader/registry.
- `modules/` — pluggable features (budget, vehicles, vault, home, users, blackhole),
  bind-mounted into the API container at runtime.
- `os/` — **thriveOS**, the appliance-image build: a reproducible amd64 Debian image
  that boots straight into thrive. Host needs only Docker. See [os/README.md](os/README.md).

## Run

```bash
cd core
docker compose up -d --build
```

Access at http://<host>:9500. See [CLAUDE.md](CLAUDE.md) for architecture details.

## Naming & layering

Two layers — **`thrive-root`** (the portable app: `core/` + `modules/`) baked into
**`thriveOS`** (the appliance OS, Debian-backed), which ships in three editions —
**`thrive-sprout`** (headless), **`thrive-sapling`** (wall), **`thrive-tree`**
(desktop). `thrive-root` can also run **bare** on a host that already has an OS (e.g. a
NAS). Full canon: [NAMING.md](NAMING.md).
