# thrive — naming & layering model (canonical)

This is the canonical vocabulary for how thrive is layered and shipped. It exists so
the terms are used **consistently** across the repo, commits, and conversation. It is
a *vocabulary*, not a refactor: **nothing in the codebase is renamed to match this
yet** (see [Known divergence](#known-divergence-code-still-says-sprout)).

---

## The model — two layers

There are **two layers**, not three. The thing people sometimes call a "third layer"
(the sprout/sapling/tree spins) is not a layer — it is **layer 2 enumerated**.

```
thrive-root        the app — portable payload (core/ + modules/)
   │  baked into
   ▼
thriveOS           the appliance OS — ships in 3 editions:
                     thrive-sprout    headless
                     thrive-sapling   wall (ambient touch panel)
                     thrive-tree      desktop (full multi-pane)
```

Delivery is **orthogonal** to the layers (see [Delivery paths](#delivery-paths)):
`thrive-root` can ship **bare** (no thriveOS under it) or baked into a thriveOS
**appliance** edition.

---

## Layer 1 — `thrive-root`

The platform itself: `core/` + `modules/`. **Distro-agnostic and OS-agnostic.** It is
the *payload* — the portable kernel of value. It runs anywhere Docker runs and at
`:9500`. Every form factor contains it; nothing about it knows what's underneath.

`thrive-root` is the thing that can exist **without** thriveOS (run it bare on a host
that already has an OS). That independence is what makes it a distinct layer.

> "thrive-root" is the *concept name* for the platform. The repo's directories
> (`core/`, `modules/`) and the app's user-facing name (**thrive**) are unchanged.

---

## Layer 2 — `thriveOS`

The appliance OS that `thrive-root` rides on. Defined as a **contract, not as
"Debian":**

- minimal footprint
- Docker host
- UEFI / boots-to-role
- pulls thrive at first boot
- ships `thrive-root`

**Anything that satisfies that contract is a valid thriveOS.** When present, thriveOS
*is the whole operating system of that machine* — which is why "OS" is the right word.
thriveOS cannot exist without `thrive-root` (shipping it is its entire job); that's the
inverse of layer 1's independence.

### Backbone (the distro is a build variable)

The distro *underneath* thriveOS is a build variable called the **backbone**. Today the
**backbone = Debian trixie**. Swapping the backbone later does **not** change what
thriveOS *is* — the contract is the identity, the distro is an implementation detail.

---

## Editions — `thrive-sst` (`thrive-{sprout, sapling, tree}`)

The three **editions** of thriveOS — same OS, same backbone, same contract, configured
for a **surface**. They are *members of the thriveOS category*, not a layer on top, so
they inherit the family surname: `thriveOS-sprout`, `thriveOS-sapling`, `thriveOS-tree`
(shortened to `thrive-sprout` etc. where context is clear). Collectively: **thrive-sst**.

| edition          | surface                          |
|------------------|----------------------------------|
| `thrive-sprout`  | **headless**                     |
| `thrive-sapling` | **wall** (ambient touch panel)   |
| `thrive-tree`    | **desktop** (full multi-pane)    |

---

## Delivery paths

`thrive-root` ships **two** ways — orthogonal to the layering above:

1. **bare** — `thrive-root` alone on a host that already has an OS (e.g. a NAS,
   Synology/TrueNAS/Unraid, or any existing Docker host). This is what was previously
   called the **"service."** It needs no separate name: it is just `thrive-root` with
   **no thriveOS under it**.
2. **appliance** — `thrive-root` baked into thriveOS and emitted as a **thrive-sst**
   edition.

---

## Future backbones (naming hook)

Editions stay `thriveOS-sprout` / `-sapling` / `-tree`, with **Debian implicit** as the
default backbone. Only **qualify** the name if a different backbone is forked later:

```
thriveOS-sprout            (Debian backbone — implicit, today)
thriveOS-arch-sprout       (hypothetical Arch backbone — qualified)
```

No renames today. The door is left open.

---

## Mapping onto the build (as it actually is)

The thriveOS build (`os/`) uses **mkosi**, and `os/Makefile` already has real targets.
This is how the sst vocabulary maps onto them **today** — stated as the Makefile is, not
as it might become. **The sst distinction is currently config/role, not a target per
edition.**

| Makefile target | what it does today                                          | edition it corresponds to |
|-----------------|-------------------------------------------------------------|---------------------------|
| `make image`    | builds the amd64 appliance (`sprout.raw`); `os/mkosi.conf` currently bakes XFCE/LightDM/Firefox | **thrive-tree** (desktop), on amd64 |
| `make pi-image` | arm64 Pi 5 image (`sprout-pi.raw`); **default `EDITION=kiosk`** = the cage/chromium wall | **thrive-sapling** (wall), on Pi |
| `make pi-desktop` | `pi-image EDITION=desktop` — XFCE/LightDM via the `desktop` mkosi profile | **thrive-tree** (desktop), on Pi |
| `make vm`       | boots the built image in QEMU — a **test action**, not an edition | (n/a) |
| `make vmdk`     | `sprout.raw` → `.vmdk` (VirtualBox/VMware/Proxmox) — a **delivery format** | (n/a) |
| `make vdi`      | `sprout.raw` → `.vdi` (VirtualBox) — a **delivery format**        | (n/a) |

Not yet covered by any target:

- **`thrive-sprout` (headless)** — *no target builds it yet.* A headless edition (the
  stack, no display) is the natural next OS build; today nothing emits it.
- **bare delivery** (`thrive-root` on an existing host) — *no target*; it's `docker
  compose up` from `core/` on a host that already has an OS.

---

## Known divergence: code still says "sprout"

The codebase predates this vocabulary and **uses "sprout" generically** for the
appliance/distro — which now collides with the specific edition name. This is expected
and **left as-is for now** (no renames today):

- `os/mkosi.conf`: `ImageId=sprout`, `Hostname=sprout`; output `sprout.raw`
- `os/pi/`: `sprout-pi.raw`, `sprout-kiosk.service`, `SPROUTBOOT` / `sprout-root` labels,
  `sprout-grow.service`
- `os/README.md`: describes **"Sprout"** as *the* bootable distro

Under this model, the code's current "sprout" artifacts actually map to **sapling**
(the Pi wall) and **tree** (the amd64/Pi desktop) — *not* to the new `thrive-sprout`
(headless), which has no build yet. A future rename pass can align the artifacts to the
edition names; until then, read "sprout" in `os/` as "the appliance image," and use the
edition names (`thrive-sprout/sapling/tree`) when talking about **surfaces**.
