"""
Generic fallback scraper — works on any e-commerce site.

Uses Scrapling's Fetcher (fast HTTP with TLS/browser fingerprint spoofing)
for static pages, and DynamicFetcher for pages that need JavaScript.

Extraction order:
1. JSON-LD structured data (most reliable for generic sites)
2. Open Graph / meta tags
3. Schema.org microdata attributes
4. Scrapling adaptive CSS heuristics (price/title patterns)
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from .base import BaseScraper, dedupe_images, detect_currency, parse_price

logger = logging.getLogger(__name__)


class GenericScraper(BaseScraper):
    """
    Fallback scraper for any e-commerce URL not handled by a specialist scraper.

    It tries fast HTTP first; if the page contains no usable product data, it
    retries with a full headless browser (DynamicFetcher).
    """

    def scrape(
        self,
        url: str,
        use_dynamic: bool = False,
        save_selectors: bool = True,
        include_raw: bool = False,
        **kwargs,
    ) -> dict:
        from scrapling.fetchers import Fetcher, DynamicFetcher

        logger.info("[Generic] Fetching %s (dynamic=%s)", url, use_dynamic)

        try:
            if use_dynamic:
                page = DynamicFetcher.fetch(url, headless=True, network_idle=True)
            else:
                page = Fetcher.get(url, stealthy_headers=True, impersonate="chrome")
        except Exception as exc:
            logger.error("[Generic] Fetch failed: %s", exc)
            return {"error": str(exc), "url": url, "domain": _domain(url)}

        html = str(page.html) if hasattr(page, "html") else ""
        result: dict[str, Any] = {
            "url": url,
            "domain": _domain(url),
            "scraper": "generic",
            "source": "backend",
        }
        auto_save = save_selectors

        # ------------------------------------------------------------------
        # JSON-LD
        # ------------------------------------------------------------------
        for ld_el in page.css('script[type="application/ld+json"]'):
            try:
                ld = json.loads(ld_el.text)
                if isinstance(ld, list):
                    ld = next((x for x in ld if x.get("@type") == "Product"), {})
                if ld.get("@type") == "Product":
                    result["title"] = ld.get("name")
                    result["description"] = ld.get("description")
                    offers = ld.get("offers") or {}
                    if isinstance(offers, list):
                        offers = offers[0] if offers else {}
                    result["price"] = offers.get("price") or offers.get("lowPrice")
                    result["original_price"] = offers.get("highPrice")
                    result["currency"] = offers.get("priceCurrency")
                    result["availability"] = offers.get("availability", "").split("/")[-1] or None
                    brand = ld.get("brand")
                    result["brand"] = brand.get("name") if isinstance(brand, dict) else brand
                    result["sku"] = ld.get("sku") or ld.get("mpn")
                    imgs = ld.get("image")
                    if imgs:
                        result["images"] = [imgs] if isinstance(imgs, str) else imgs
                    agg = ld.get("aggregateRating") or {}
                    result["rating"] = agg.get("ratingValue")
                    result["review_count"] = agg.get("reviewCount")
                    result["extraction_method"] = "json_ld"
                    break
            except Exception:
                pass

        # Breadcrumb from JSON-LD
        if not result.get("category"):
            for ld_el in page.css('script[type="application/ld+json"]'):
                try:
                    ld = json.loads(ld_el.text)
                    if ld.get("@type") == "BreadcrumbList":
                        items = sorted(
                            ld.get("itemListElement", []),
                            key=lambda x: x.get("position", 0),
                        )
                        result["category"] = " > ".join(
                            i.get("name") or (i.get("item") or {}).get("name") or ""
                            for i in items
                            if i.get("name") or (i.get("item") or {}).get("name")
                        )
                        break
                except Exception:
                    pass

        # ------------------------------------------------------------------
        # Open Graph / meta
        # ------------------------------------------------------------------
        def _meta(prop: str, name_attr: str = "property") -> Optional[str]:
            try:
                el = page.css(f'meta[{name_attr}="{prop}"]')
                return el.attrib.get("content") if el else None
            except Exception:
                return None

        result.setdefault("title", _meta("og:title"))
        result.setdefault("description", _meta("og:description") or _meta("description", "name"))
        if not result.get("images"):
            og_img = _meta("og:image")
            if og_img:
                result["images"] = [og_img]
        if not result.get("price"):
            result["price"] = (
                _meta("product:price:amount")
                or _meta("price", "itemprop")
                or _meta("price", "name")
            )
        result.setdefault("currency", _meta("product:price:currency"))

        # ------------------------------------------------------------------
        # Schema.org microdata (itemprop attributes)
        # ------------------------------------------------------------------
        def _itemprop(prop: str) -> Optional[str]:
            try:
                el = page.css(f'[itemprop="{prop}"]')
                if not el:
                    return None
                return (
                    el.attrib.get("content")
                    or el.attrib.get("href")
                    or el.get_text(strip=True)
                )
            except Exception:
                return None

        result.setdefault("title", _itemprop("name"))
        result.setdefault("price", _itemprop("price"))
        result.setdefault("currency", _itemprop("priceCurrency"))
        result.setdefault("brand", _itemprop("brand"))

        # ------------------------------------------------------------------
        # Generic heuristic CSS selectors (last resort)
        # ------------------------------------------------------------------
        if not result.get("title"):
            for sel in ["h1", "h1.product-title", "[class*='product-title']", "[class*='productTitle']"]:
                try:
                    el = page.css(sel, auto_save=auto_save)
                    v = el.get_text(strip=True) if el else None
                    if v and len(v) > 5:
                        result["title"] = v
                        result["extraction_method"] = result.get("extraction_method") or "css"
                        break
                except Exception:
                    pass

        if not result.get("price"):
            for sel in [
                '[class*="price" i]:not([class*="original" i]):not([class*="old" i]):not([class*="was" i])',
                '[itemprop="price"]',
                '.price',
            ]:
                try:
                    el = page.css(sel, auto_save=auto_save)
                    if el:
                        raw = el.get_text(strip=True)
                        parsed = parse_price(raw)
                        if parsed is not None:
                            result["price"] = parsed
                            result["extraction_method"] = result.get("extraction_method") or "css"
                            break
                except Exception:
                    pass

        # If no product data found with fast HTTP, try dynamic browser
        if not result.get("title") and not use_dynamic:
            logger.info("[Generic] Retrying with DynamicFetcher for %s", url)
            return self.scrape(url, use_dynamic=True, save_selectors=save_selectors,
                               include_raw=include_raw, **kwargs)

        # Currency detection
        if not result.get("currency"):
            result["currency"] = detect_currency(str(result.get("price") or "")) or None

        return self._post_process(result, html)


def _domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        return urlparse(url).netloc
    except Exception:
        return ""
