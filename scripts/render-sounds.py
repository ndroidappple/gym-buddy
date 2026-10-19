"""Renders GymBuddy's sounds in src/assets/sounds/ from earshot's sound bank
(https://github.com/Leonxlnx/earshot): sounds stored as code, rendered with no recordings and no models.
Run after changing a sound here: npm run sounds (add --listen to also score each one by ear, below).

Needs Python 3.10+, ffmpeg, and earshot (bank rendering needs only its light dependencies):
  pip install numpy scipy soundfile soxr librosa pyloudnorm numba
  pip install --no-deps git+https://github.com/Leonxlnx/earshot
--listen loads earshot's two listening models (about 1.1 GB, downloaded once), so it also needs torch and
transformers: pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install transformers

Each sound is one or more bank renders (an id, a seed, knobs) layered at set times, mixed to mono, set to its
level, audited (earshot's model-free check: clicks, clipping, cut tails, comb ring ...) and written as a mono
MP3. A sound the audit warns on is not written. MP3 because every browser's decodeAudioData reads it (open-source
Chromium can't decode AAC) and Chromium trims its encoder padding; five sounds come to about 100 KB."""
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf
from earshot.forge import bank, sfx
from earshot.gallery import lufs_max

SR = 48000
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "sounds")
BELL = "fit/bell/small_bell"  # a small bell struck once, fitted as code from a CC0 recording
DING = "pro_notify/ding_2045"  # a short clean designed ding
KALIMBA = "pluck/kalimba_ring"  # a kalimba tine that rings longer

# name: layers (bank id, knobs, start s), length s (None: the render's own), level dB re a -1 dBFS peak, and
# what it should sound like (--listen). Levels follow earshot's calm kit roles: bell -3, click -4.5, tick -5.
# The tonal ones share C major, so a PR and the finish never clash.
SOUNDS = {
    # Logging a set: the tap iPhones can't give (no vibration on the web). A bamboo tok, one attack.
    "set": ([("fit/hit/bamboo_tok", {}, 0)], None, -4.5, "a short solid click of a button locking in place"),
    # 3, 2, 1 before rest ends: domino pieces knocking, quiet.
    "tick": ([("fit/tick/domino", {}, 0)], None, -5, "a soft quiet wooden tick"),
    # Rest over: the bell struck twice, 0.2 s apart (two takes, so the strikes differ), like a ring bell.
    "rest": ([(BELL, {}, 0), (BELL, {"seed": 1}, 0.2)], 1.9, -3, "a timer bell going off"),
    # A PR: four dings up C major, C6 to C7.
    "pr": ([(DING, {"pitch": p}, i * 0.08) for i, p in enumerate(["C6", "E6", "G6", "C7"])], 1.0, -3,
           "a bright happy celebratory chime, a reward sound"),
    # Workout finished: a slower kalimba arpeggio, G5 to G6, that rings out.
    "done": ([(KALIMBA, {"pitch": p}, i * 0.11) for i, p in enumerate(["G5", "C6", "E6", "G6"])], 2.6, -3,
             "a warm resolving chime, a success sound"),
}
# What a sound should not be mistaken for (--listen: forced choice against the description).
CHEAP = ["a cheap synthesizer laser zap", "a video game blip", "an 8-bit chiptune sound", "an annoying electronic beep"]


def render(layers, length):
    takes = []
    for sid, knobs, at in layers:
        y, meta = bank.render(sid, **knobs)
        if not meta["checks"]["ok"]:
            sys.exit(f"{sid} {knobs}: {meta['checks']['summary']}")
        takes.append((int(round(at * SR)), y.mean(axis=1) if y.ndim == 2 else y))
    n = int(round(length * SR)) if length else max(i + len(y) for i, y in takes)
    mix = np.zeros(n)
    for i, y in takes:
        mix[i:i + len(y)] += y[:n - i]
    if length:  # cut to length: a raised-cosine fade so the cut never clicks
        f = min(int(0.15 * SR), n // 4)
        mix[-f:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, f)))
    return mix / np.abs(mix).max()


def main():
    listen = "--listen" in sys.argv[1:]
    os.makedirs(OUT, exist_ok=True)
    print(f"earshot bank {bank.VERSION}")
    made = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, (layers, length, level, _) in SOUNDS.items():
            y = (render(layers, length) * 10 ** ((level - 1) / 20)).astype(np.float32)
            check = sfx.check(y)
            if not check["ok"]:
                sys.exit(f"{name}: {check['summary']}")
            wav, mp3 = os.path.join(tmp, f"{name}.wav"), os.path.join(OUT, f"{name}.mp3")
            sf.write(wav, y, SR, subtype="PCM_24")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-map_metadata", "-1", "-c:a", "libmp3lame",
                            "-b:a", "128k", mp3], check=True)
            print(f"{name:5s} {len(y) / SR:.2f} s, peak {20 * np.log10(np.abs(y).max()):.1f} dBFS, "
                  f"{lufs_max(y):.1f} LUFS momentary max, {os.path.getsize(mp3) / 1000:.1f} KB  "
                  f"({check['summary'].split(': ', 1)[1]})")
            made.append((name, mp3))
    if listen:
        from earshot import api
        print("\nBy ear (earshot match: z among its 322 descriptions, and the forced choice against cheap synth sounds):")
        for name, mp3 in made:
            m = api.match(mp3, SOUNDS[name][3], alts=CHEAP)
            tags = ", ".join(t["term"] for t in api.describe(mp3, top=3)["top_tags"][:3])
            print(f"{name:5s} '{SOUNDS[name][3]}': z {m['z']:+.2f} {m['verdict']}, "
                  f"{m['p_vs_alts']:.0%} over cheap synth | sounds like {tags}")


if __name__ == "__main__":
    main()
