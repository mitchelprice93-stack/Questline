"""
Safe-zone the Android adaptive icon foreground.

Android's adaptive icon spec asks for the visible content to sit within
the inner ~66% of the foreground canvas, with transparent padding around
it. The launcher then masks the outer edge (circle, squircle, rounded
square — varies) without cropping the visible artwork.

When the foreground PNG fills the canvas edge-to-edge, the launcher's
mask crops parts of the artwork unevenly, which makes the icon look
slightly off-center on the home screen.

This script reads `assets/images/android-icon-foreground.png`, backs up
the original, then writes a new version where the artwork is scaled
down to SCALE * canvas size and centered on a fully-transparent canvas
of the original dimensions.

Usage:
    python scripts/icon-safe-zone.py            # uses default 0.70 scale
    SCALE=0.66 python scripts/icon-safe-zone.py # tighter (spec minimum)
    SCALE=0.75 python scripts/icon-safe-zone.py # looser (more breathing room)

Requirements:
    pip install Pillow

After running, rebuild the AAB (`eas build --platform android --profile
production`) — icons are baked into the build, not OTA-pushable.
"""

import os
import shutil
import sys

from PIL import Image

# Resolve repo-relative path to the foreground PNG. Script lives at
# <repo>/scripts/icon-safe-zone.py, so the asset is one level up.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO_ROOT, "assets", "images", "android-icon-foreground.png")
BACKUP = SRC.replace(".png", ".original.png")

# Scale factor for the artwork relative to canvas size. Android's adaptive
# icon spec allows 66% as the minimum visible-content area; 70% gives a
# small safety buffer while still letting the icon fill the launcher's
# mask comfortably.
SCALE = float(os.environ.get("SCALE", "0.70"))


def main() -> int:
    if not os.path.exists(SRC):
        print(f"ERROR: source not found: {SRC}", file=sys.stderr)
        return 1

    # Backup once — re-running the script shouldn't overwrite the original
    # with the already-modified version.
    if not os.path.exists(BACKUP):
        shutil.copy(SRC, BACKUP)
        print(f"Backup saved: {BACKUP}")
    else:
        print(f"Backup already exists at: {BACKUP}")
        print("  (re-runs will re-process from the CURRENT foreground, not the original)")
        print("  Delete the backup if you want a fresh start from the original.")

    # Read source, force to RGBA so the surround can be transparent
    # regardless of the source's mode.
    img = Image.open(SRC).convert("RGBA")
    width, height = img.size
    print(f"Source: {width}x{height}, mode RGBA")

    # Scale the artwork to SCALE * canvas using LANCZOS for high quality.
    new_w = int(width * SCALE)
    new_h = int(height * SCALE)
    scaled = img.resize((new_w, new_h), Image.LANCZOS)

    # Create a new fully-transparent canvas at original size.
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    # Center the scaled artwork on the canvas.
    x = (width - new_w) // 2
    y = (height - new_h) // 2
    canvas.paste(scaled, (x, y), scaled)

    # Save back to source path, overwriting.
    canvas.save(SRC, "PNG", optimize=True)

    print(f"Wrote: {SRC}")
    print(f"  Artwork size:   {new_w}x{new_h} ({int(SCALE * 100)}% of canvas)")
    print(f"  Inset margins:  {x}px horizontal, {y}px vertical")
    print(f"  Surround:       fully transparent")
    print()
    print("Next steps:")
    print("  1. Rebuild the AAB: eas build --platform android --profile production")
    print("  2. Upload to Play Console closed-alpha as a new release")
    print("  3. Verify on phone: launcher icon should now sit centered within its mask")
    return 0


if __name__ == "__main__":
    sys.exit(main())
