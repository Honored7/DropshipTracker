"""
Alibaba product scraper powered by Scrapling.

Uses DynamicFetcher (full Playwright) for Alibaba because its product pages
rely on heavy React rendering and frequently need JavaScript execution.

Strategy:
1. __INITIAL_STATE__ / window.__data__ JSON (brace-counting)
2. JSON-LD structured data
3. Scrapling adaptive CSS selectors (auto_save=True)
4. Open Graph / meta fallbacks
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from .base import (
    BaseScraper,
    dedupe_images,
    detect_currency,
    extract_all_json_from_scripts,
    merge_json_product_data,
    parse_price,
)

logger = logging.getLogger(__name__)

_JSON_PATTERNS = [
    r"__INITIAL_STATE__\s*=\s*\{",
    r"window\.__data__\s*=\s*\{",
    r"_init_data_\s*=\s*\{",
    r"window\.pageData\s*=\s*\{",
]

_SELECTOR_DB = "scrapling_alibaba.db"


class AlibabaScraper(BaseScraper):
    """
    Scrapes a single Alibaba product detail or offer page.

    Usage::

        scraper = AlibabaScraper()
        result  = scraper.scrape("https://www.alibaba.com/product-detail/...")
    """

    JSON_PATTERNS = _JSON_PATTERNS

    def scrape(
        self,
        url: str,
        save_selectors: bool = True,
        include_raw: bool = False,
        **kwargs,
    ) -> dict:
        """
        Extract product data from an Alibaba product page.

        Parameters
        ----------
        url:
            Full Alibaba product/offer URL.
        save_selectors:
            Persist Scrapling adaptive fingerprints to ``_SELECTOR_DB``.
        include_raw:
            Include raw parsed JSON in the response (for debugging).
        """
        from scrapling.fetchers import DynamicFetcher

        logger.info("[Alibaba] Fetching %s", url)

        try:
            page = DynamicFetcher.fetch(
                url,
                headless=True,
                network_idle=True,
                disable_resources=False,
            )
        except Exception as exc:
            logger.error("[Alibaba] Fetch failed: %s", exc)
            return {"error": str(exc), "url": url, "domain": "alibaba.com"}

        html = str(page.html) if hasattr(page, "html") else ""
        result: dict[str, Any] = {
            "url": url,
            "domain": "alibaba.com",
            "scraper": "alibaba",
            "source": "backend",
        }
        auto_save = save_selectors
        raw_data_for_report: dict = {}

        # ------------------------------------------------------------------
        # STEP 1 — Embedded JSON
        # ------------------------------------------------------------------
        raw_jsons = extract_all_json_from_scripts(html, _JSON_PATTERNS)
        for data in raw_jsons:
            merge_json_product_data(result, data)
            if include_raw and not raw_data_for_report:
                raw_data_for_report = data

        if result.get("title"):
            result["extraction_method"] = "json"
            logger.info("[Alibaba] JSON extraction succeeded: %s", result.get("title"))

        # ------------------------------------------------------------------
        # STEP 2 — JSON-LD
        # ------------------------------------------------------------------
        if not result.get("title"):
            for ld_el in page.css('script[type="application/ld+json"]'):
                try:
                    ld = json.loads(ld_el.text)
                    if isinstance(ld, list):
                        ld = next((x for x in ld if x.get("@type") == "Product"), {})
                    if ld.get("@type") == "Product":
                        result.setdefault("title", ld.get("name"))
                        result.setdefault("description", ld.get("description"))
                        offers = ld.get("offers") or {}
                        result.setdefault("price", offers.get("price") or offers.get("lowPrice"))
                        result.setdefault("currency", offers.get("priceCurrency"))
                        brand = ld.get("brand")
                        result.setdefault(
                            "brand",
                            brand.get("name") if isinstance(brand, dict) else brand,
                        )
                        imgs = ld.get("image")
                        if imgs and not result.get("images"):
                            result["images"] = [imgs] if isinstance(imgs, str) else imgs
                        agg = ld.get("aggregateRating") or {}
                        result.setdefault("rating", agg.get("ratingValue"))
                        result.setdefault("review_count", agg.get("reviewCount"))
                        result["extraction_method"] = result.get("extraction_method") or "json_ld"
                        break
                except Exception:
                    pass

        # ------------------------------------------------------------------
        # STEP 3 — Adaptive CSS selectors
        # ------------------------------------------------------------------

        def _text(sel: str, adaptive: bool = False) -> Optional[str]:
            try:
                el = page.css(sel, auto_save=auto_save, adaptive=adaptive)
                return el.get_text(strip=True) if el else None
            except Exception:
                return None

        def _texts(sel: str) -> list[str]:
            try:
                els = page.css(sel, auto_save=auto_save)
                return [e.get_text(strip=True) for e in (els if hasattr(els, "__iter__") else []) if e]
            except Exception:
                return []

        def _attr(sel: str, attr: str) -> Optional[str]:
            try:
                el = page.css(sel, auto_save=auto_save)
                return el.attrib.get(attr) if el else None
            except Exception:
                return None

        # Title
        if not result.get("title"):
            for sel in [
                "h1.ma-title",
                ".detail-title",
                ".module-pdp-title h1",
                "h1[class*='title']",
                "h1",
            ]:
                v = _text(sel, adaptive=True)
                if v and len(v) > 5:
                    result["title"] = v
                    result["extraction_method"] = "css"
                    break

        # Price
        if not result.get("price"):
            for sel in [
                ".ma-ref-price .ma-ref-price-value",
                ".ma-ref-price",
                ".price-original .price-value",
                ".module-pdp-price .price-value",
                ".module-pdp-price .price",
            ]:
                v = _text(sel, adaptive=True)
                if v:
                    result["price"] = v
                    result["extraction_method"] = result.get("extraction_method") or "css"
                    break

        # Images — Alibaba SVGs are navigation icons; filter them out
        if not result.get("images"):
            imgs = []
            for sel in [
                '.detail-gallery-turn img:not([src$=".svg"])',
                ".main-image img",
                ".thumb-list img",
                'img[src*="alicdn.com"][src$=".jpg"]',
            ]:
                try:
                    for img_el in page.css(sel, auto_save=auto_save):
                        src = img_el.attrib.get("src") or ""
                        if src and not src.endswith(".svg"):
                            imgs.append(src)
                except Exception:
                    pass
            if imgs:
                result["images"] = imgs

        # Store / supplier
        if not result.get("store_name"):
            for sel in [".company-name a", "[class*='supplierName']", "[class*='company-name']"]:
                v = _text(sel, adaptive=True)
                if v:
                    result["store_name"] = v
                    break

        # MOQ (minimum order quantity — Alibaba-specific)
        if not result.get("min_order"):
            for sel in ["[class*='min-order']", "[class*='moq']", "[class*='minimum']"]:
                v = _text(sel, adaptive=True)
                if v:
                    result["min_order"] = v
                    break

        # Rating
        if not result.get("rating"):
            v = _text('[class*="supplier-rating"] [class*="score"]', adaptive=True)
            if v:
                m = re.search(r"([\d.]+)", v)
                if m:
                    result["rating"] = float(m.group(1))

        # Category
        if not result.get("category"):
            crumbs = _texts(".breadcrumb a")
            if crumbs:
                result["category"] = " > ".join(c for c in crumbs if c and len(c) > 1)

        # Specifications — definition list + two-span heuristic
        if not result.get("specifications"):
            specs: list[dict] = []
            seen: set[str] = set()
            for sel in [
                "[class*='Spec']",
                ".do-entry-item",
                ".product-attr-list",
                ".attribute-list",
            ]:
                try:
                    items = page.css(f"{sel} li, {sel} div, {sel} tr, {sel}")
                    for item in (items if hasattr(items, "__iter__") else []):
                        spans = list(item.css("span")) if hasattr(item.css("span"), "__iter__") else []
                        if len(spans) >= 2:
                            name = spans[0].get_text(strip=True).rstrip(":")
                            value = spans[-1].get_text(strip=True)
                            k = f"{name}:{value}".lower()
                            if name and value and name != value and len(name) > 1 and k not in seen:
                                seen.add(k)
                                specs.append({"name": name, "value": value})
                except Exception:
                    pass
                if specs:
                    break
            if specs:
                result["specifications"] = specs

        # Open Graph fallbacks
        if not result.get("title"):
            result["title"] = _attr('meta[property="og:title"]', "content")
        if not result.get("images"):
            og_img = _attr('meta[property="og:image"]', "content")
            if og_img:
                result["images"] = [og_img]

        # Product ID
        if not result.get("product_id"):
            for pat in [
                r"/product-detail/[^_]*_(\d{5,})",
                r"/offer/(\d+)",
                r"productId=(\d+)",
            ]:
                m = re.search(pat, url)
                if m:
                    result["product_id"] = m.group(1)
                    break

        # Currency
        if not result.get("currency"):
            result["currency"] = detect_currency(str(result.get("price") or "")) or "USD"

        if include_raw:
            result["raw_json"] = raw_data_for_report

        return self._post_process(result, html)
