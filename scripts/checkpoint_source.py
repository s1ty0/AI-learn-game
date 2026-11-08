"""Create an auditable source snapshot without changing Git identity or committing.

Only Git-visible project source is included. Runtime data, credentials, dependencies
and the Git directory are excluded. A manifest lets the archive be verified later.
"""

import hashlib
import json
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]


def main():
    raw = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT)
    paths = sorted({name.decode("utf-8") for name in raw.split(b"\0") if name})
    files = []
    for relative in paths:
        file = (ROOT / relative).resolve()
        if ROOT not in file.parents or not file.is_file():
            raise ValueError(f"Not a regular project file: {relative}")
        parts = set(Path(relative).parts)
        if parts.intersection({".git", ".runtime", ".venv", "node_modules", ".next", ".codex", ".agents"}) or file.name.startswith(".env"):
            raise ValueError(f"Refusing runtime/private configuration: {relative}")
        files.append((relative, file.read_bytes()))
    time = datetime.now(ZoneInfo("Asia/Shanghai"))
    folder = ROOT / ".runtime/checkpoints"
    folder.mkdir(parents=True, exist_ok=True)
    archive = folder / f"learnai-{time:%Y%m%d-%H%M%S}-source.zip"
    manifest = {"created_at": time.isoformat(), "kind": "source-snapshot-not-git-commit",
                "files": [{"path": relative, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for relative, data in files]}
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as output:
        for relative, data in files:
            output.writestr(relative, data)
        output.writestr("CHECKPOINT-MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    with zipfile.ZipFile(archive) as check:
        assert check.testzip() is None
        for item in manifest["files"]:
            assert hashlib.sha256(check.read(item["path"])).hexdigest() == item["sha256"]
    print(f"Verified source snapshot: {archive}")
    print(f"Files: {len(files)}; bytes: {archive.stat().st_size}; no Git config changed or commit created.")


if __name__ == "__main__":
    main()
