#!/usr/bin/env bash
# sprout-pi image build — runs INSIDE the privileged build container (see
# Makefile `pi-image`). Three phases:
#   1. register qemu-aarch64 binfmt so the arm64 chroot's maintainer scripts run
#      on this amd64 host (fix-binary flag → works inside chroots transparently)
#   2. mkosi builds the arm64 rootfs into ./sprout-pi (Format=directory)
#   3. assemble the bootable MBR disk: FAT32 firmware partition (Pi GPU firmware
#      + kernel + initrd + dtb + config.txt/cmdline.txt) + ext4 root, → ../sprout-pi.raw
#
# The Pi firmware does NOT read GPT — hence MBR via sfdisk and none of mkosi's
# own disk machinery. Loop devices need --privileged.
set -euo pipefail
cd "$(dirname "$0")"

IMG=../sprout-pi.raw
ROOTFS=./sprout-pi
BOOT_MB=512
# PROFILE=user (default) → quiet boot + Thrive plymouth splash; PROFILE=dev → verbose
# console (kernel/systemd text). Same image either way; only cmdline.txt differs.
PROFILE="${PROFILE:-user}"
echo "[pi-build] profile: $PROFILE"
# EDITION=kiosk (default) → the cage/chromium wall; EDITION=desktop → XFCE/LightDM,
# which selects the `desktop` mkosi profile (mkosi.profiles/desktop.conf adds the DE).
# Orthogonal to PROFILE (which only controls boot verbosity / plymouth splash).
EDITION="${EDITION:-kiosk}"
echo "[pi-build] edition: $EDITION"
PROFILE_ARG=()
[ "$EDITION" = desktop ] && PROFILE_ARG=(--profile desktop)

# ── 1. binfmt for arm64 emulation ────────────────────────────────────────────
# trixie's qemu-user-static ships systemd-binfmt configs (/usr/lib/binfmt.d/*.conf),
# not update-binfmts descriptors — feed the aarch64 line straight to the kernel.
# Registration is host-global kernel state (that's the point) and idempotent here.
if [ ! -f /proc/sys/fs/binfmt_misc/register ]; then
    mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc
fi
if [ ! -f /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then
    grep -v '^#' /usr/lib/binfmt.d/qemu-aarch64.conf > /proc/sys/fs/binfmt_misc/register
fi
[ -f /proc/sys/fs/binfmt_misc/qemu-aarch64 ] || {
    echo "FATAL: qemu-aarch64 binfmt not registered — arm64 build impossible"; exit 1; }
grep -q F /proc/sys/fs/binfmt_misc/qemu-aarch64 || \
    echo "[pi-build] WARN: binfmt lacks the F (fix-binary) flag — chroot exec may fail"
echo "[pi-build] qemu-aarch64 binfmt ready"

# ── 2. rootfs via mkosi ──────────────────────────────────────────────────────
# SKIP_MKOSI=1 reuses an already-built ./sprout-pi (handy when iterating on the
# disk assembly below without re-emulating the whole arm64 rootfs build).
if [ "${SKIP_MKOSI:-0}" = 1 ]; then
    echo "[pi-build] SKIP_MKOSI=1 — reusing existing $ROOTFS"
else
    mkosi "${PROFILE_ARG[@]}" --package-cache-directory=/work/mkosi.cache --force build
fi
[ -d "$ROOTFS" ] || { echo "FATAL: rootfs '$ROOTFS' missing — check mkosi OutputDirectory"; exit 1; }

# sanity: the RPi kernel package + its raspi-firmware ALREADY assembled the whole
# firmware partition in the rootfs (kernel_2712.img, initramfs_2712, every dtb,
# overlays/, GPU firmware) — unlike Debian's mainline raspi-firmware, the RPi one's
# hook populates /boot/firmware during the build. We just verify the Pi 5 pieces.
FW="$ROOTFS/boot/firmware"
[ -f "$FW/kernel_2712.img" ]     || { echo "FATAL: kernel_2712.img missing — RPi Pi 5 kernel didn't install?"; exit 1; }
[ -f "$FW/bcm2712-rpi-5-b.dtb" ] || { echo "FATAL: Pi 5 devicetree (bcm2712-rpi-5-b.dtb) missing"; exit 1; }
[ -f "$FW/initramfs_2712" ]      || { echo "FATAL: initramfs_2712 missing (initramfs hook didn't run?)"; exit 1; }
echo "[pi-build] rootfs ok — firmware partition pre-assembled by raspi-firmware (Pi 5)"

# ── 3. assemble the MBR disk image ───────────────────────────────────────────
ROOT_MB=$(du -sm --exclude=proc --exclude=sys --exclude=dev "$ROOTFS" | cut -f1)
IMG_MB=$(( BOOT_MB + ROOT_MB * 13 / 10 + 512 ))   # 30% fs slack + headroom; first boot grows anyway
echo "[pi-build] rootfs ${ROOT_MB}M → image ${IMG_MB}M"

rm -f "$IMG"
truncate -s "${IMG_MB}M" "$IMG"
sfdisk "$IMG" <<EOF
label: dos
,${BOOT_MB}MiB,c,*
,,L
EOF

# The build container has no udev/devtmpfs to create ${LOOP}p1/p2 from a whole-disk
# -P scan (and there's no kpartx). So instead attach EACH partition as its own loop
# device via --offset/--sizelimit. The MBR from sfdisk above is what the Pi firmware
# actually reads; these loops are only how WE format+populate. Offsets are
# deterministic from the sfdisk layout (1MiB-aligned p1 of BOOT_MB, p2 follows).
SECT=512
P1_OFF=$(( 2048 * SECT ))                 # first partition starts at sector 2048 (1 MiB)
P1_SIZE=$(( BOOT_MB * 1024 * 1024 ))       # FAT32 firmware partition = BOOT_MB
P2_OFF=$(( P1_OFF + P1_SIZE ))             # ext4 root immediately after
# ensure loop-device nodes exist: this build container's /dev may not have them
# (no udev), and `losetup -f` can pick a free NUMBER whose /dev node is missing →
# "failed to set up loop device ... device node /dev/loopN is lost". Pre-create a
# generous range (privileged container, so mknod works).
for i in $(seq 0 63); do [ -e "/dev/loop$i" ] || mknod "/dev/loop$i" b 7 "$i" 2>/dev/null || true; done
LOOP1=$(losetup --show -f --offset "$P1_OFF" --sizelimit "$P1_SIZE" "$IMG")
LOOP2=$(losetup --show -f --offset "$P2_OFF" "$IMG")
trap 'umount -R /mnt/sprout 2>/dev/null || true; losetup -d "$LOOP1" "$LOOP2" 2>/dev/null || true' EXIT

mkfs.vfat -n SPROUTBOOT "$LOOP1"
mkfs.ext4 -q -L sprout-root "$LOOP2"

mkdir -p /mnt/sprout
mount "$LOOP2" /mnt/sprout
echo "[pi-build] copying rootfs…"
cp -a "$ROOTFS"/. /mnt/sprout/
mkdir -p /mnt/sprout/boot/firmware
mount "$LOOP1" /mnt/sprout/boot/firmware

# firmware partition: just mirror the tree raspi-firmware already assembled in the
# rootfs (kernel_2712.img + initramfs_2712 + all dtbs + overlays/ + GPU firmware).
# cp -a onto FAT can't preserve perms (harmless warnings); the data is what matters.
echo "[pi-build] copying firmware partition…"
cp -a "$ROOTFS"/boot/firmware/. /mnt/sprout/boot/firmware/

# config.txt — on Pi 5 the firmware auto-selects kernel_2712.img + bcm2712-rpi-5-b.dtb
# by board, and auto_initramfs loads the matching initramfs_2712 alongside it. So
# this stays minimal: 64-bit, serial console for headless debug.
cat > /mnt/sprout/boot/firmware/config.txt <<'EOF'
# sprout-pi boot config — Raspberry Pi 5 (BCM2712), headless thrive appliance.
[all]
arm_64bit=1
enable_uart=1
auto_initramfs=1
EOF

# loglevel/audit: same console-noise rationale as the amd64 image. serial0 is the
# Pi's primary debug UART. root by LABEL (set above with mkfs.ext4 -L sprout-root).
# cmdline.txt — single line. root by LABEL; init= explicit (the Pi boots /sbin/init by
# default, we point straight at systemd). dev keeps the verbose console; user goes
# quiet + splash so plymouth shows the Thrive logo instead of kernel text.
COMMON="root=LABEL=sprout-root rootfstype=ext4 rootwait fsck.repair=yes audit=0 init=/usr/lib/systemd/systemd"
if [ "$PROFILE" = dev ]; then
    echo "console=serial0,115200 console=tty1 $COMMON loglevel=4" > /mnt/sprout/boot/firmware/cmdline.txt
else
    echo "console=tty1 console=serial0,115200 $COMMON quiet loglevel=3 splash plymouth.ignore-serial-consoles" > /mnt/sprout/boot/firmware/cmdline.txt
fi

umount -R /mnt/sprout
losetup -d "$LOOP1" "$LOOP2"
trap - EXIT
echo "[pi-build] done: $(cd .. && pwd)/sprout-pi.raw (${IMG_MB}M) — dd it to an SD card"
