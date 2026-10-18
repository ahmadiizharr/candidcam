import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _env_path(name: str, default: Path) -> Path:
    return Path(os.environ[name]) if name in os.environ else default


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: _env_path("CANDID_DATA_DIR", ROOT / "backend" / "data"))
    dist_dir: Path = field(default_factory=lambda: _env_path("CANDID_DIST_DIR", ROOT / "frontend" / "dist"))
    catalog_file: Path = ROOT / "shared" / "catalog.json"
    public_base_url: str = field(default_factory=lambda: os.environ.get("CANDID_PUBLIC_URL", "http://localhost:8094").rstrip("/"))
    session_days: int = 30
    max_upload_mb: int = 15
    # Foto tamu disimpan 12 bulan sejak foto pertama, lalu dihapus otomatis.
    retention_days: int = 365

    @property
    def db_path(self) -> Path:
        return self.data_dir / "candid.db"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def secret_path(self) -> Path:
        return self.data_dir / "secret.key"
