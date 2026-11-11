"""Bundle public course files into the API service; never copy local state."""
from pathlib import Path
from shutil import copytree


def prepare_content():
    service = Path(__file__).resolve().parent
    repository = service.parents[1]
    destination = service / ".vercel-content"
    for relative in ("data/catalog", "data/quests", "data/games",
                     "knowledge/zh-CN/transformer", "knowledge/zh-CN/expedition"):
        copytree(repository / relative, destination / relative, dirs_exist_ok=True)
    print("Packaged public course content; database migrations run separately.")


if __name__ == "__main__":
    prepare_content()
