"""
DropshipTracker — Scrapling-powered extraction backend.

Exposes a local FastAPI server the Chrome extension (and web dashboard) can
call for reliable, anti-bot-bypassing product data extraction.

Quick start:
    pip install -r requirements.txt
    scrapling install
    uvicorn backend.main:app --reload --port 8000

Endpoints:
    GET  /health          — liveness check
    POST /extract         — extract a single product URL
    POST /search          — keyword search (AliExpress / Alibaba)

CORS is open to localhost so the Chrome extension can POST from any tab.
"""

from __future__ import annotations

import importlib.metadata
import logging
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import extract, search
from .models.product import HealthResponse

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Scrapling version (surfaced in /health)
# ---------------------------------------------------------------------------
def _scrapling_version() -> str:
    try:
        return importlib.metadata.version("scrapling")
    except importlib.metadata.PackageNotFoundError:
        return "not installed"


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    v = _scrapling_version()
    logger.info("DropshipTracker backend starting — Scrapling %s", v)
    # Validate Scrapling is installed correctly
    if v == "not installed":
        logger.warning(
            "Scrapling not found!  Run: pip install 'scrapling[fetchers]' && scrapling install"
        )
    yield
    logger.info("DropshipTracker backend shutting down")


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------
app = FastAPI(
    title="DropshipTracker Backend",
    description=(
        "Scrapling-powered product extraction service for the DropshipTracker "
        "Chrome extension. Bypasses AliExpress/Alibaba bot protection using "
        "Scrapling's StealthyFetcher + adaptive CSS selectors."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ---------------------------------------------------------------------------
# CORS — Chrome extensions make cross-origin requests from chrome-extension://
# Allow localhost:* so the extension can reach the server while it's running
# locally.  Restrict this if you deploy to a remote server.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "null",          # Chrome extensions send Origin: null
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(extract.router, tags=["Extraction"])
app.include_router(search.router, tags=["Search"])


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health():
    """Liveness probe — returns OK and the installed Scrapling version."""
    return HealthResponse(
        status="ok",
        version="1.0.0",
        scrapling_version=_scrapling_version(),
    )


# ---------------------------------------------------------------------------
# Entry point for `python -m backend.main`
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
