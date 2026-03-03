"""
AliExpress product scraper powered by Scrapling.

Strategy (mirrors the Chrome extension's cascade):
1. window.runParams JSON  — extracted with brace-counting
2. __INITIAL_STATE__ / _initData JSON
3. JSON-LD <script type="application/ld+json">
4. Scrapling adaptive CSS selectors  (auto_save=True saves fingerprints so
   they survive AliExpress DOM reorder/class-name changes)
5. Open Graph / meta fallbacks

Fetcher choice:
- StealthyFetcher  — headless Playwright with full anti-bot fingerprint
  spoofing; handles Cloudflare + AliExpress bot checks.
- Adaptive=True on selectors means Scrapling automatically re-locates
  elements if class names change between scrapes.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional
from urllib.parse import urlencode, urlparse

from .base import (
    BaseScraper,
    dedupe_images,
    detect_currency,
    extract_all_json_from_scripts,
    merge_json_product_data,
    normalise_weight_to_kg,
    parse_price,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# JSON start-marker patterns for AliExpress
# ---------------------------------------------------------------------------
_JSON_PATTERNS = [
    r"window\.runParams\s*[=,]\s*\{",
    r"window\.__runParams__\s*=\s*\{",
    r"_initData\s*=\s*\{",
    r"__INITIAL_STATE__\s*=\s*\{",
    r"window\.__state__\s*=\s*\{",
]

# ---------------------------------------------------------------------------
# Adaptive CSS selector fingerprint storage path
# Scrapling saves learned element fingerprints here so `adaptive=True` can
# re-locate elements after AliExpress CSS class renamings.
# ---------------------------------------------------------------------------
_SELECTOR_DB = "scrapling_aliexpress.db"


class AliExpressScraper(BaseScraper):
    """
    Scrapes a single AliExpress product detail page.

    Usage::

        scraper = AliExpressScraper()
        result  = scraper.scrape("https://www.aliexpress.com/item/1005006...html")
    """

    JSON_PATTERNS = _JSON_PATTERNS

    def scrape(
        self,
        url: str,
        use_stealth: bool = True,
        save_selectors: bool = True,
        include_reviews: bool = False,
        include_raw: bool = False,
        **kwargs,
    ) -> dict:
        """
        Extract product data from an AliExpress product page.

        Parameters
        ----------
        url:
            Full AliExpress item URL.
        use_stealth:
            When True (default) uses StealthyFetcher which bypasses bot detection.
            When False falls back to DynamicFetcher (faster, less stealth).
        save_selectors:
            Persist Scrapling adaptive fingerprints to `_SELECTOR_DB`.
        include_reviews:
            Attempt to scrape the first page of reviews (adds ~3s latency).
        include_raw:
            Include the raw parsed JSON in the response (for debugging).
        """
        from scrapling.fetchers import StealthyFetcher, DynamicFetcher

        logger.info("[AliExpress] Fetching %s (stealth=%s)", url, use_stealth)

        try:
            if use_stealth:
                page = StealthyFetcher.fetch(
                    url,
                    headless=True,
                    network_idle=True,
                    disable_resources=False,    # We need JS to run for runParams
                )
            else:
                page = DynamicFetcher.fetch(
                    url,
                    headless=True,
                    network_idle=True,
                    disable_resources=False,
                )
        except Exception as exc:
            logger.error("[AliExpress] Fetch failed: %s", exc)
            return {"error": str(exc), "url": url, "domain": "aliexpress.com"}

        html = str(page.html) if hasattr(page, "html") else ""
        result: dict[str, Any] = {
            "url": url,
            "domain": "aliexpress.com",
            "scraper": "aliexpress",
            "source": "backend",
        }

        # ------------------------------------------------------------------
        # STEP 1 — Embedded JSON (window.runParams + fallbacks)
        # ------------------------------------------------------------------
        raw_jsons = extract_all_json_from_scripts(html, _JSON_PATTERNS)
        raw_data_for_report: dict = {}
        for data in raw_jsons:
            merge_json_product_data(result, data)
            if include_raw and not raw_data_for_report:
                raw_data_for_report = data

        if result.get("title"):
            result["extraction_method"] = "json"
            logger.info("[AliExpress] JSON extraction succeeded: %s", result.get("title"))

        # ------------------------------------------------------------------
        # STEP 2 — JSON-LD
        # ------------------------------------------------------------------
        if not result.get("title") or not result.get("price"):
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
                        result.setdefault("brand", (ld.get("brand") or {}).get("name") or ld.get("brand"))
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
        # STEP 3 — Scrapling adaptive CSS selectors
        # These use auto_save=True so Scrapling stores the element's fingerprint.
        # On subsequent scrapes, adaptive=True re-locates the element even if
        # AliExpress renames CSS classes.
        # ------------------------------------------------------------------
        auto_save = save_selectors

        def _text(selector: str, adaptive: bool = False) -> Optional[str]:
            try:
                el = page.css(selector, auto_save=auto_save, adaptive=adaptive)
                return el.get_text(strip=True) if el else None
            except Exception:
                return None

        def _texts(selector: str, adaptive: bool = False) -> list[str]:
            try:
                els = page.css(selector, auto_save=auto_save, adaptive=adaptive)
                return [e.get_text(strip=True) for e in (els if hasattr(els, "__iter__") else []) if e]
            except Exception:
                return []

        def _attr(selector: str, attribute: str, adaptive: bool = False) -> Optional[str]:
            try:
                el = page.css(selector, auto_save=auto_save, adaptive=adaptive)
                return el.attrib.get(attribute) if el else None
            except Exception:
                return None

        # Title
        if not result.get("title"):
            for sel in [
                'h1[data-pl="product-title"]',
                ".product-title-text",
                "h1.pdp-title",
                '[class*="ProductTitle--text"]',
                '[class*="title--wrap"] h1',
                "h1",
            ]:
                v = _text(sel, adaptive=True)
                if v and len(v) > 5:
                    result["title"] = v
                    result["extraction_method"] = "css"
                    break

        # Price — reassemble char-by-char price (AliExpress renders prices as
        # individual <span> characters wrapped in a parent)
        if not result.get("price"):
            for sel in [
                '[class*="Price--currentPriceText"]',
                '[class*="es--wrap--"] [class*="es--char--"]',
                ".product-price-current span",
                '[class*="uniform-banner-box-price"]',
                ".product-price-value",
            ]:
                try:
                    chars = _texts(sel, adaptive=True)
                    if chars:
                        raw_price = "".join(chars).strip()
                        result["price"] = raw_price
                        result["extraction_method"] = result.get("extraction_method") or "css"
                        break
                except Exception:
                    pass

        # Original / sale price
        if not result.get("original_price"):
            for sel in [
                '[class*="Price--originalText"]',
                "[class*='price--original']",
                ".product-price-original",
                "[class*='price'] del",
            ]:
                v = _text(sel, adaptive=True)
                if v:
                    result["original_price"] = v
                    break

        # Images
        if not result.get("images"):
            imgs = []
            for sel in [
                ".images-view-list img",
                '[class*="slider--wrap"] img',
                '[class*="Gallery"] img[src*="aliexpress"]',
                "[class*='image-view'] img",
            ]:
                try:
                    els = page.css(sel, auto_save=auto_save)
                    for el in (els if hasattr(els, "__iter__") else []):
                        src = el.attrib.get("src") or el.attrib.get("data-src") or ""
                        if src and "aliexpress" in src:
                            imgs.append(src)
                except Exception:
                    pass
            if imgs:
                result["images"] = imgs

        # Store name
        if not result.get("store_name"):
            for sel in ["[class*='store-name']", "[class*='StoreName']", ".shop-name a"]:
                v = _text(sel, adaptive=True)
                if v:
                    result["store_name"] = v
                    break

        # Rating
        if not result.get("rating"):
            v = _text('[class*="score--wrap"]', adaptive=True) or _text('[itemprop="ratingValue"]')
            if v:
                m = re.search(r"([\d.]+)", v)
                if m:
                    result["rating"] = float(m.group(1))

        # Review count
        if not result.get("review_count"):
            v = _text('[class*="reviewer--reviews"]', adaptive=True) or _text('[class*="feedback-count"]')
            if v:
                m = re.search(r"([\d,]+)", v)
                if m:
                    result["review_count"] = int(m.group(1).replace(",", ""))

        # Orders / sold
        if not result.get("orders"):
            v = _text('[class*="sold"]', adaptive=True) or _text('[class*="Orders"]')
            if v:
                m = re.search(r"([\d,]+)", v)
                if m:
                    result["orders"] = int(m.group(1).replace(",", ""))

        # Category / breadcrumb
        if not result.get("category"):
            crumbs = _texts('[class*="breadcrumb"] a', adaptive=True)
            if crumbs:
                result["category"] = " > ".join(c for c in crumbs if c and len(c) > 1)

        # Shipping
        if not result.get("shipping"):
            v = _text('[class*="Shipping"]', adaptive=True) or _text(".product-shipping")
            if v:
                result["shipping"] = v

        # Specifications fallback — two-span pattern
        if not result.get("specifications"):
            specs = _extract_specs_from_page(page)
            if specs:
                result["specifications"] = specs

        # Variants fallback — read from DOM if JSON didn't yield them
        if not result.get("variant_groups"):
            vg = _extract_variant_groups_from_page(page, auto_save)
            if vg:
                result["variant_groups"] = vg

        # ------------------------------------------------------------------
        # STEP 4 — Open Graph / meta
        # ------------------------------------------------------------------
        if not result.get("title"):
            result["title"] = _attr('meta[property="og:title"]', "content")
        if not result.get("description"):
            result["description"] = (
                _attr('meta[property="og:description"]', "content")
                or _attr('meta[name="description"]', "content")
            )
        if not result.get("images"):
            og_img = _attr('meta[property="og:image"]', "content")
            if og_img:
                result["images"] = [og_img]

        # ------------------------------------------------------------------
        # Product ID
        # ------------------------------------------------------------------
        if not result.get("product_id"):
            m = re.search(r"/item/(\d+)\.html", url)
            if m:
                result["product_id"] = m.group(1)

        # ------------------------------------------------------------------
        # Currency
        # ------------------------------------------------------------------
        if not result.get("currency"):
            result["currency"] = detect_currency(str(result.get("price") or "")) or "USD"

        # ------------------------------------------------------------------
        # Reviews (optional — slower)
        # ------------------------------------------------------------------
        if include_reviews:
            result["reviews"] = _scrape_reviews(url, result.get("product_id"))

        # ------------------------------------------------------------------
        # Raw JSON (for debug)
        # ------------------------------------------------------------------
        if include_raw:
            result["raw_json"] = raw_data_for_report

        return self._post_process(result, html)


# ---------------------------------------------------------------------------
# Helper functions (module-level, not instance methods)
# ---------------------------------------------------------------------------

def _extract_specs_from_page(page) -> list[dict]:
    """
    Extract specification key-value pairs using a two-span heuristic —
    mirrors the JS fallback added in Phase 1.
    """
    specs: list[dict] = []
    seen: set[str] = set()

    def _try(selector: str) -> bool:
        try:
            container = page.css(selector)
            if not container:
                return False
            items = page.css(f"{selector} li, {selector} div, {selector} tr")
            for item in (items if hasattr(items, "__iter__") else []):
                spans = item.css("span")
                spans_list = list(spans) if hasattr(spans, "__iter__") else []
                if len(spans_list) >= 2:
                    name = spans_list[0].get_text(strip=True).rstrip(":")
                    value = spans_list[-1].get_text(strip=True)
                    key = f"{name}:{value}".lower()
                    if name and value and name != value and len(name) > 1 and key not in seen:
                        seen.add(key)
                        specs.append({"name": name, "value": value})
            return len(specs) > 0
        except Exception:
            return False

    for sel in [
        ".pdp-mod-product-specs",
        "[class*='specification']",
        "[class*='Specification']",
        ".product-specs",
        "[class*='product-prop']",
    ]:
        if _try(sel):
            break

    return specs


def _extract_variant_groups_from_page(page, auto_save: bool = True) -> list[dict]:
    """Extract variant groups (Color, Size, etc.) from the DOM."""
    groups: dict[str, list] = {}
    try:
        for group_el in page.css(".sku-property, [class*='Sku--property'], [class*='sku-property']"):
            name_el = group_el.css("[class*='title'], [class*='name'], .sku-title, label")
            group_name = (name_el.get_text(strip=True).rstrip(":") if name_el else "Option") or "Option"
            if group_name not in groups:
                groups[group_name] = []
            for item in group_el.css("[class*='item'], .sku-property-item, button[class*='sku']"):
                v_name = item.attrib.get("title") or item.get_text(strip=True)
                if v_name and len(v_name) < 100:
                    img_el = item.css("img")
                    groups[group_name].append({
                        "name": v_name,
                        "image": (img_el.attrib.get("src") if img_el else None),
                    })
    except Exception:
        pass
    return [{"name": k, "values": v} for k, v in groups.items() if v]


def _scrape_reviews(product_url: str, product_id: Optional[str]) -> list[dict]:
    """
    Attempt to fetch the first page of AliExpress reviews.
    Uses a lightweight HTTP request instead of a full browser.
    """
    if not product_id:
        return []
    try:
        from scrapling.fetchers import Fetcher
        review_url = (
            f"https://feedback.aliexpress.com/display/productEvaluation.htm?"
            + urlencode({"productId": product_id, "ownerMemberId": "", "page": 1})
        )
        page = Fetcher.get(review_url, stealthy_headers=True)
        reviews = []
        for item in page.css(".feedback-item"):
            reviews.append({
                "author": (item.css(".user-name").get_text(strip=True) if item.css(".user-name") else None),
                "rating": _count_stars(item),
                "date": (item.css(".r-time-new").get_text(strip=True) if item.css(".r-time-new") else None),
                "text": (item.css(".buyer-feedback span:first-child").get_text(strip=True)
                         if item.css(".buyer-feedback") else None),
                "country": (item.css(".user-country b").get_text(strip=True)
                            if item.css(".user-country") else None),
                "images": [
                    img.attrib.get("src", "")
                    for img in item.css(".r-photo-list img")
                    if img.attrib.get("src")
                ],
            })
        return reviews
    except Exception as exc:
        logger.warning("[AliExpress] Review scrape failed: %s", exc)
        return []


def _count_stars(item) -> Optional[int]:
    """Count filled star elements to determine a review's star rating."""
    try:
        stars = item.css(".star-on, [class*='star-full'], [class*='starFilled']")
        count = len(list(stars)) if hasattr(stars, "__iter__") else 0
        return count if 1 <= count <= 5 else None
    except Exception:
        return None
