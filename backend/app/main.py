from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.router import router
from .config import settings
from .database import Base, engine, migrate_legacy_schema
from .database import SessionLocal
from .models import Category
from sqlalchemy import select
from .services.backups import ensure_daily_backup

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_legacy_schema()
    with SessionLocal() as db:
        if db.scalar(select(Category.id).limit(1)) is None:
            db.add_all([
                Category(name="Vivienda", color="#6f8fb8"), Category(name="Supermercado", color="#79a66b"),
                Category(name="Restaurantes", color="#db9968"), Category(name="Transporte", color="#8b7bb1"),
                Category(name="Servicios", color="#5ea7a0"), Category(name="Salud", color="#cf7180"),
                Category(name="Entretenimiento", color="#c5a455"), Category(name="Viajes", color="#4e92b0"),
                Category(name="Sueldo", color="#5a9b65", is_income=True),
                Category(name="Otros ingresos", color="#78ad86", is_income=True),
            ])
            db.commit()
    try:
        ensure_daily_backup()
    except Exception:
        # A full disk or a temporary filesystem problem must not prevent MAPI
        # from opening. Manual backup will still surface the concrete error.
        logger.exception("Could not create the automatic daily backup")
    yield


app = FastAPI(title="MAPI API", description="Mi Administración de Patrimonio e Inversiones", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])
app.include_router(router, prefix="/api")
