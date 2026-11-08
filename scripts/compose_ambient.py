"""Render the project's original procedural ambient loop using the standard library.

No third-party recording, melody sample or pretrained audio model is used.
Run from any working directory: python scripts/compose_ambient.py
"""

import hashlib
import json
import math
import struct
import wave
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RATE = 22050
DURATION = 64
FRAMES = RATE * DURATION


def render():
    samples = array("f", [0.0]) * FRAMES

    def note(midi, start, duration, level, bell=False):
        frequency = 440 * 2 ** ((midi - 69) / 12)
        for i in range(round(duration * RATE)):
            t = i / RATE
            envelope = math.sin(math.pi * t / duration) ** 2
            tone = math.sin(2 * math.pi * frequency * t)
            tone += (0.13 if bell else 0.06) * math.sin(2 * math.pi * frequency * 2 * t)
            if bell:
                envelope *= math.exp(-t / 2.5)
            samples[(round(start * RATE) + i) % FRAMES] += level * envelope * tone

    # A slow C-add9 / A-min7 / F-maj9 / G-sus2 progression with open voicings.
    chords = [(48, 55, 62, 64), (45, 55, 60, 64), (41, 52, 57, 60), (43, 50, 57, 62)]
    for bar in range(8):
        for pitch in chords[bar % 4]:
            note(pitch, bar * 8 - 2, 12, 0.022)
    melody = [72, 76, 79, 74, 72, 69, 76, 74, 72, 76, 81, 79, 74, 71, 74, 67]
    for index, pitch in enumerate(melody):
        note(pitch, index * 4 + 1, 7, 0.055, bell=True)

    peak = max(abs(value) for value in samples)
    scale = 0.34 / max(peak, 1e-9)
    pcm = b"".join(struct.pack("<h", round(value * scale * 32767)) for value in samples)
    destination = ROOT / "apps/web/public/audio"
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / "mist-sea-glow.wav"
    with wave.open(str(target), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm)
    metadata = {
        "id": "mist-sea-glow-v1", "title": "雾海微光", "duration_seconds": DURATION,
        "sample_rate": RATE, "channels": 1, "format": "PCM16 WAV", "tempo_bpm": 60,
        "origin": "Project-authored procedural score and synthesis; no third-party samples.",
        "source_script": "scripts/compose_ambient.py", "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "loop": "Note tails wrap periodically across the 64-second boundary.",
        "review_status": "Playable prototype; subjective listening and device comfort remain to be reviewed."
    }
    (destination / "manifest.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    rms = math.sqrt(sum(value * value for value in samples) / FRAMES) * scale
    seam = abs(samples[0] - samples[-1]) * scale
    print(f"Rendered {DURATION}s original loop; peak=0.340, RMS={rms:.4f}, seam_delta={seam:.6f}, bytes={target.stat().st_size}")


if __name__ == "__main__":
    render()
