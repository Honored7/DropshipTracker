"""
/extract — Single product extraction endpoint.

POST /extract
Body: { "url": "https://...", "use_stealth": true, ... }

Automatically routes to the correct scraper based on the URL's domain.
Falls back to GenericScraper for unsupported domains.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException

from ..models.product import ExtractRequest, ProductResult
from ..scrapers.aliexpress import AliExpressScraper
from ..scrapers.alibaba import AlibabaScraper
from ..scrapers.generic import GenericScraper

logger = logging.getLogger(__name__)
router = APIRouter()

# Domain → scraper class mapping
# Add new scrapers here as they are implemented.
_SCRAPERS = {
    "aliexpress.com": AliExpressScraper,
    "alibaba.com": AlibabaScraper,
}


def _pick_scraper(url: str):
    """Return the appropriate scraper instance for the given URL."""
    host = urlparse(url).netloc.lower()
    for domain, cls in _SCRAPERS.items():
        if domain in host:
            return cls()
    return GenericScraper()


@router.post("/extract", response_model=ProductResult, summary="Extract a single product")
async def extract_product(req: ExtractRequest):
    """
    Extract structured product data from any supported supplier URL.

    - **url** — Full product page URL (AliExpress, Alibaba, or any site)
    - **use_stealth** — Use StealthyFetcher for bot bypass (default true)
    - **use_dynamic** — Force full headless browser regardless of domain
    - **save_selectors** — Persist Scrapling adaptive fingerprints (default true)
    - **include_reviews** — Also scrape reviews (slower)
    - **include_raw** — Include raw parsed JSON in response body (debug)

    Returns a `ProductResult` with all extracted fields.
    Errors are returned as `{"error": "..."}` inside the model with HTTP 200
    so the Chrome extension can display them without raising an exception.
    """
    if not req.url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")

    scraper = _pick_scraper(req.url)
    logger.info("[/extract] %s → %s", req.url, scraper.__class__.__name__)

    try:
        raw = scraper.scrape(
            url=req.url,
            use_stealth=req.use_stealth,
            use_dynamic=req.use_dynamic,
            save_selectors=req.save_selectors,
            include_reviews=req.include_reviews,
            include_raw=req.include_raw,
        )
    except Exception as exc:
        logger.exception("[/extract] Unhandled error for %s", req.url)
        raw = {"url": req.url, "domain": urlparse(req.url).netloc, "error": str(exc)}

    # Coerce raw dict into ProductResult (unknown fields are silently dropped)
    return ProductResult(**{k: v for k, v in raw.items() if v is not None})
