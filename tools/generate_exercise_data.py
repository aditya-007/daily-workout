#!/usr/bin/env python3
"""
generate_exercise_data.py
--------------------------
Build-time helper that scans the exercise folders (Abs, Arm, Chest, Legs,
"Shoulder and Back") and produces `js/data/exercises.js` — a plain JS file
(NOT json fetched at runtime, since fetch()/XHR of local files is blocked by
browsers when the app is opened via file://).

HOW TO ADD / REMOVE / REPLACE AN EXERCISE
------------------------------------------
1. Add a new folder under the right category, e.g. `Chest/New_Exercise/`,
   containing an `instructions.txt` (Hindi instructions, one "N" line
   followed by the Hindi text line, repeated) and two `.mp4` files whose
   names contain the words "front" and "side".
2. Add a matching entry to EXERCISE_META below (title in Hindi + reps/sets
   or a holdSeconds value). If you skip this step the script will fall back
   to a generic title and default reps, but you should still add a proper
   Hindi title.
3. Re-run this script:  `python tools/generate_exercise_data.py`
4. Add the new exercise's id (printed by this script / found in
   js/data/exercises.js) to the relevant day in `js/data/schedule.js`.

To remove an exercise, delete its folder (or just stop referencing its id
in schedule.js) and re-run this script.
"""

import json
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "js" / "data" / "exercises.js"

# Devanagari (Hindi) unicode block. Any line containing at least one of
# these characters is treated as a real instruction step; every other line
# (plain numbers, English fallback text, "Exercise Name:" metadata headers,
# "Video:" comments, etc.) is discarded. This one rule works uniformly
# across every instructions.txt format variant found in this project.
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")

# Category folder name -> (category id, Hindi label)
CATEGORIES = [
    ("Abs", "abs", "कोर"),
    ("Arm", "arm", "बांह"),
    ("Chest", "chest", "छाती"),
    ("Legs", "legs", "पैर"),
    ("Shoulder and Back", "shoulder-back", "कंधे और पीठ"),
]

# Hand-authored content: Hindi display title + senior-friendly default
# reps/sets (dynamic exercises) or holdSeconds/sets (isometric holds).
# Keyed by the exercise id this script generates (category-id + slugified
# folder name). See slugify() below for exactly how ids are built.
EXERCISE_META = {
    # ---- Abs ----
    "abs-alternate-leg-raise": {"titleHi": "एक-एक कर पैर उठाना", "reps": 10, "sets": 2},
    "abs-crunches": {"titleHi": "क्रंचेस", "reps": 12, "sets": 2},
    "abs-dumbell-overhead-side-bend": {"titleHi": "डम्बल ओवरहेड साइड बेंड", "reps": 10, "sets": 2},
    "abs-dumbell-russian-twist": {"titleHi": "डम्बल रशियन ट्विस्ट", "reps": 10, "sets": 2},
    "abs-dumbell-side-bend": {"titleHi": "डम्बल साइड बेंड", "reps": 10, "sets": 2},
    "abs-elbow-side-plank": {"titleHi": "कोहनी साइड प्लैंक", "holdSeconds": 20, "sets": 2},
    "abs-heel-touch": {"titleHi": "एड़ी छूना", "reps": 12, "sets": 2},
    "abs-leg-raises": {"titleHi": "पैर उठाना", "reps": 10, "sets": 2},
    "abs-mountain-climber": {"titleHi": "माउंटेन क्लाइम्बर", "reps": 15, "sets": 2},
    "abs-plank": {"titleHi": "प्लैंक", "holdSeconds": 25, "sets": 2},
    "abs-scissor-kick": {"titleHi": "कैंची किक", "reps": 12, "sets": 2},
    "abs-sideways-scissor-kick": {"titleHi": "साइड कैंची किक", "reps": 12, "sets": 2},
    # ---- Arm ----
    "arm-arm-rotation": {"titleHi": "बांह घुमाना", "holdSeconds": 20, "sets": 2},
    "arm-bench-dips": {"titleHi": "बेंच डिप्स", "reps": 8, "sets": 2},
    "arm-diamond-push-up": {"titleHi": "डायमंड पुश अप", "reps": 6, "sets": 2},
    "arm-dumbell-biceps-curl": {"titleHi": "डम्बल बाइसेप्स कर्ल", "reps": 10, "sets": 2},
    "arm-dumbell-hammer-curl": {"titleHi": "डम्बल हैमर कर्ल", "reps": 10, "sets": 2},
    "arm-dumbell-kneeling-single-arm-row": {"titleHi": "डम्बल घुटने टेक सिंगल आर्म रो", "reps": 10, "sets": 2},
    "arm-dumbell-rear-delt-row": {"titleHi": "डम्बल रियर डेल्ट रो", "reps": 10, "sets": 2},
    "arm-dumbell-triceps-kickback": {"titleHi": "डम्बल ट्राइसेप्स किकबैक", "reps": 10, "sets": 2},
    "arm-seated-dumbell-tricep-extenstion": {"titleHi": "बैठकर डम्बल ट्राइसेप एक्सटेंशन", "reps": 10, "sets": 2},
    # ---- Chest ----
    "chest-diamond-knee-assisted-push-up": {"titleHi": "घुटनों के सहारे डायमंड पुश अप", "reps": 8, "sets": 2},
    "chest-dumbell-chest-fly": {"titleHi": "डम्बल चेस्ट फ्लाई", "reps": 10, "sets": 2},
    "chest-dumbell-floor-press": {"titleHi": "डम्बल फ्लोर प्रेस", "reps": 10, "sets": 2},
    "chest-incline-push-up": {"titleHi": "इनक्लाइन पुश अप", "reps": 10, "sets": 2},
    "chest-push-up": {"titleHi": "पुश अप", "reps": 8, "sets": 2},
    # ---- Legs ----
    "legs-bodyweight-squat": {"titleHi": "बॉडीवेट स्क्वाट", "reps": 10, "sets": 2},
    "legs-bulgarian-split-squat": {"titleHi": "बल्गेरियन स्प्लिट स्क्वाट", "reps": 8, "sets": 2},
    "legs-calf-raise": {"titleHi": "काफ रेज़", "reps": 15, "sets": 2},
    "legs-dumbell-calf-raise": {"titleHi": "डम्बल काफ रेज़", "reps": 12, "sets": 2},
    "legs-dumbell-glute-bridge": {"titleHi": "डम्बल ग्लूट ब्रिज", "reps": 12, "sets": 2},
    "legs-dumbell-goblet-squat": {"titleHi": "डम्बल गॉब्लेट स्क्वाट", "reps": 10, "sets": 2},
    "legs-dumbell-leg-extension": {"titleHi": "डम्बल लेग एक्सटेंशन", "reps": 10, "sets": 2},
    "legs-dumbell-romanian-deadlift": {"titleHi": "डम्बल रोमानियन डेडलिफ्ट", "reps": 10, "sets": 2},
    "legs-dumbell-single-leg-calf-raise": {"titleHi": "डम्बल एक पैर काफ रेज़", "reps": 10, "sets": 2},
    "legs-forward-lunges": {"titleHi": "फॉरवर्ड लंज", "reps": 8, "sets": 2},
    "legs-seated-dumbell-calf-raise": {"titleHi": "बैठकर डम्बल काफ रेज़", "reps": 12, "sets": 2},
    "legs-side-lunges": {"titleHi": "साइड लंज", "reps": 8, "sets": 2},
    "legs-single-leg-calf-raise": {"titleHi": "एक पैर काफ रेज़", "reps": 10, "sets": 2},
    "legs-walking-calf-raise": {"titleHi": "वॉकिंग काफ रेज़", "reps": 12, "sets": 2},
    "legs-walking-lunge": {"titleHi": "वॉकिंग लंज", "reps": 8, "sets": 2},
    "legs-wall-sit": {"titleHi": "वॉल सिट", "holdSeconds": 20, "sets": 2},
    # ---- Shoulder and Back ----
    "shoulder-back-bodyweight-pike-press": {"titleHi": "पाइक प्रेस", "reps": 8, "sets": 2},
    "shoulder-back-bodyweight-superman-pull": {"titleHi": "सुपरमैन पुल", "reps": 10, "sets": 2},
    "shoulder-back-dumbell-rear-delt-fly": {"titleHi": "डम्बल रियर डेल्ट फ्लाई", "reps": 10, "sets": 2},
    "shoulder-back-dumbell-shrug": {"titleHi": "डम्बल श्रग", "reps": 12, "sets": 2},
    "shoulder-back-side-leg-raise": {"titleHi": "साइड लेग रेज़", "reps": 10, "sets": 2},
}


def slugify(text: str) -> str:
    """Lowercase, replace runs of non-alphanumeric characters with a single
    hyphen, and strip leading/trailing hyphens."""
    text = text.lower().replace("_", "-")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def find_instructions_file(folder: Path) -> Path | None:
    """instructions.txt is spelled with different casing across folders;
    find it case-insensitively."""
    for child in folder.iterdir():
        if child.is_file() and child.name.lower() == "instructions.txt":
            return child
    return None


def extract_hindi_steps(instructions_path: Path) -> list[str]:
    """Keep only lines containing Devanagari characters, in file order.
    This discards numeric index lines, English fallback text, and any
    metadata header/footer lines regardless of instructions.txt format."""
    text = instructions_path.read_text(encoding="utf-8", errors="replace")
    steps = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line and DEVANAGARI_RE.search(line):
            steps.append(line)
    return steps


def find_videos(folder: Path) -> tuple[str | None, str | None]:
    """Return (front_filename, side_filename) by matching "front"/"side"
    substrings in the mp4 filenames (case-insensitive). Falls back to
    reusing whichever single video is found if only one exists."""
    front, side = None, None
    mp4s = sorted(folder.glob("*.mp4"))
    for mp4 in mp4s:
        lower = mp4.name.lower()
        if "front" in lower and front is None:
            front = mp4.name
        elif "side" in lower and side is None:
            side = mp4.name
    if front is None and side is not None:
        front = side
    if side is None and front is not None:
        side = front
    return front, side


def to_url_path(*parts: str) -> str:
    """Build a browser-safe relative URL (encode spaces etc, keep slashes)."""
    joined = "/".join(parts)
    return urllib.parse.quote(joined, safe="/")


def build_exercises() -> list[dict]:
    exercises = []
    missing_meta = []

    for folder_name, category_id, category_label in CATEGORIES:
        category_dir = ROOT / folder_name
        if not category_dir.is_dir():
            print(f"WARNING: category folder not found: {folder_name}", file=sys.stderr)
            continue

        for exercise_dir in sorted(p for p in category_dir.iterdir() if p.is_dir()):
            instructions_path = find_instructions_file(exercise_dir)
            if instructions_path is None:
                print(f"WARNING: no instructions.txt in {exercise_dir}", file=sys.stderr)
                continue

            steps = extract_hindi_steps(instructions_path)
            if not steps:
                print(f"WARNING: no Hindi instruction lines found in {instructions_path}", file=sys.stderr)

            front_file, side_file = find_videos(exercise_dir)
            if front_file is None or side_file is None:
                print(f"WARNING: missing video(s) in {exercise_dir}", file=sys.stderr)

            exercise_id = f"{category_id}-{slugify(exercise_dir.name)}"
            meta = EXERCISE_META.get(exercise_id)
            if meta is None:
                missing_meta.append(exercise_id)
                meta = {"titleHi": exercise_dir.name.replace("_", " "), "reps": 10, "sets": 2}

            entry = {
                "id": exercise_id,
                "category": category_id,
                "categoryLabelHi": category_label,
                "titleHi": meta["titleHi"],
                "folder": to_url_path(folder_name, exercise_dir.name),
                "videoFront": to_url_path(folder_name, exercise_dir.name, front_file) if front_file else None,
                "videoSide": to_url_path(folder_name, exercise_dir.name, side_file) if side_file else None,
                "instructionsHi": steps,
            }
            if "holdSeconds" in meta:
                entry["holdSeconds"] = meta["holdSeconds"]
                entry["sets"] = meta.get("sets", 2)
            else:
                entry["reps"] = meta.get("reps", 10)
                entry["sets"] = meta.get("sets", 2)

            exercises.append(entry)

    if missing_meta:
        print(
            "WARNING: the following exercise ids have no EXERCISE_META entry "
            "and used generic fallback title/reps. Add proper Hindi titles:\n  "
            + "\n  ".join(missing_meta),
            file=sys.stderr,
        )

    return exercises


def main() -> None:
    exercises = build_exercises()

    header = (
        "// AUTO-GENERATED by tools/generate_exercise_data.py — do not hand-edit.\n"
        "// To change exercise data: edit HINDI titles/reps/sets in that script's\n"
        "// EXERCISE_META dict (or the instructions.txt / video files themselves),\n"
        "// then re-run: python tools/generate_exercise_data.py\n\n"
    )
    body = "const EXERCISES = " + json.dumps(exercises, ensure_ascii=False, indent=2) + ";\n"

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(header + body, encoding="utf-8")
    print(f"Wrote {len(exercises)} exercises to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
