"""
Base scraper — shared utilities used by all platform scrapers.

Includes:
- extract_balanced_json()  :  Brace-counting JSON extractor (Python port of the
                              JS version in productExtraction.js — same algorithm)
- merge_json_product_data():  Walk a parsed JSON tree to find product fields
- price helpers, weight normalisation, image dedup
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# JSON EXTRACTION — BRACE-COUNTING
# ---------------------------------------------------------------------------

def extract_balanced_json(text: str, from_index: int = 0) -> Optional[str]:
    """
    Extract a balanced JSON object from `text` starting at or after `from_index`.
    Tracks brace depth, string state, and escape sequences — avoids the
    non-greedy-regex truncation bug that breaks nested objects.

    Returns the matched JSON string, or None if unbalanced / no object found.
    """
    start = text.find("{", from_index)
    if start == -1:
        return None

    depth = 0
    in_string = False
    escape = False

    for i in range(start, len(text)):
        ch = text[i]

        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue

        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]

    return None  # Unbalanced — truncated or malformed script


def extract_all_json_from_scripts(html_text: str, patterns: list[str]) -> list[dict]:
    """
    Find all JSON objects in script tags matching the given start-marker patterns.
    Returns a list of successfully parsed dicts.
    """
    results: list[dict] = []

    # Pull all script tag contents
    script_bodies = re.findall(
        r"<script(?:[^>]*)>([\s\S]*?)</script>",
        html_text,
        re.IGNORECASE,
    )

    for body in script_bodies:
        if len(body) < 50:
            continue
        for pattern in patterns:
            try:
                m = re.search(pattern, body)
                if not m:
                    continue
                # The pattern should end at or just before the opening '{'.
                # We start the brace-counter at the match start so it finds the '{'.
                search_from = m.start() + len(m.group(0)) - 1
                json_str = extract_balanced_json(body, search_from)
                if json_str:
                    data = json.loads(json_str)
                    results.append(data)
            except (json.JSONDecodeError, Exception):
                pass

    return results


# ---------------------------------------------------------------------------
# JSON → PRODUCT DATA MERGING
# ---------------------------------------------------------------------------

def merge_json_product_data(result: dict, data: dict, prop_lookup: dict | None = None) -> None:
    """
    Walk a parsed JSON data structure to find product fields.
    Mutates `result` in place.  `prop_lookup` is a pre-built map of
    "propId:valueId" → {"group", "name", "image"} for AliExpress SKU decoding.
    """
    if not data or not isinstance(data, dict):
        return

    # Build prop lookup from this data if not supplied
    if prop_lookup is None:
        prop_lookup = _build_prop_lookup(data)

    search_paths = [
        data,
        data.get("data"),
        data.get("pageData"),
        data.get("productData"),
        data.get("product"),
        data.get("item"),
        data.get("storeModule"),
        data.get("priceModule"),
        data.get("titleModule"),
        data.get("descriptionModule"),
        data.get("skuModule"),
        data.get("specsModule"),
        data.get("orderModule"),
        data.get("imageModule"),
        data.get("shippingModule"),
        data.get("commonModule"),
        data.get("quantityModule"),
        data.get("reviewModule"),
        (data.get("data") or {}).get("product"),
        (data.get("data") or {}).get("priceInfo"),
        (data.get("data") or {}).get("skuInfo"),
        (data.get("result") or {}).get("product"),
    ]
    search_paths = [p for p in search_paths if isinstance(p, dict)]

    for obj in search_paths:
        # Title
        if not result.get("title"):
            result["title"] = (
                obj.get("title") or obj.get("name") or obj.get("productTitle")
                or obj.get("subject") or obj.get("productName")
            )

        # Price
        if not result.get("price"):
            price_obj = (
                obj.get("price") or obj.get("priceInfo")
                or obj.get("formatedActivityPrice") or obj.get("activityPrice")
                or obj.get("minPrice") or obj.get("salePrice")
            )
            if isinstance(price_obj, dict):
                result["price"] = (
                    price_obj.get("value") or price_obj.get("minPrice")
                    or price_obj.get("formatedPrice") or price_obj.get("actPrice")
                    or price_obj.get("salePrice") or price_obj.get("discountPrice", {}).get("minPrice")
                    or price_obj.get("formatedActivityPrice")
                )
                result.setdefault("original_price", (
                    price_obj.get("originalPrice") or price_obj.get("maxPrice")
                    or price_obj.get("formatedBiggestPrice")
                ))
                result.setdefault("currency", (
                    price_obj.get("currency") or price_obj.get("currencyCode")
                    or price_obj.get("currencySymbol")
                ))
            elif price_obj:
                result["price"] = price_obj

        # Images
        if not result.get("images"):
            imgs = (
                obj.get("images") or obj.get("imagePathList") or obj.get("imagePaths")
                or obj.get("gallery") or obj.get("imageList") or obj.get("productImages")
            )
            if isinstance(imgs, list) and imgs:
                result["images"] = [
                    ("https:" + img if isinstance(img, str) and img.startswith("//") else img)
                    if isinstance(img, str) else (img.get("url") or img.get("imgUrl") or "")
                    for img in imgs
                    if img
                ][:15]

        # SKU / product ID
        if not result.get("product_id"):
            result["product_id"] = (
                str(obj.get("sku") or obj.get("productId") or obj.get("itemId") or obj.get("id") or "")
            ) or None

        # Brand
        if not result.get("brand"):
            brand = obj.get("brand")
            result["brand"] = brand.get("name") if isinstance(brand, dict) else brand

        # Category / breadcrumb
        if not result.get("category"):
            bc = obj.get("breadcrumb")
            if isinstance(bc, list):
                result["category"] = " > ".join(
                    c if isinstance(c, str) else (c.get("name") or c.get("title") or "")
                    for c in bc
                    if c
                )
            elif obj.get("categoryPath"):
                result["category"] = obj["categoryPath"]

        # Rating / reviews
        if not result.get("rating"):
            result["rating"] = (
                obj.get("averageStar") or obj.get("averageRating")
                or obj.get("rating") or obj.get("evarageStar") or obj.get("starRating")
            )
        if not result.get("review_count"):
            result["review_count"] = (
                obj.get("totalReviews") or obj.get("reviewCount")
                or obj.get("feedbackCount") or obj.get("totalCount")
            )

        # Orders / sold count
        if not result.get("orders"):
            result["orders"] = obj.get("tradeCount") or obj.get("orderCount") or obj.get("totalOrder")

        # Description
        if not result.get("description"):
            result["description"] = (
                obj.get("description") or obj.get("detailDesc") or obj.get("productDescription")
            )

        # Stock
        if result.get("stock") is None:
            stock = (
                obj.get("stock") or obj.get("quantity") or obj.get("totalAvailQuantity")
                or obj.get("availQuantity") or obj.get("totalStock")
            )
            if stock is not None:
                result["stock"] = int(stock) if isinstance(stock, (int, float)) else stock

        # Shipping
        if not result.get("shipping"):
            ship = (
                obj.get("shippingFee") or obj.get("freightAmount") or obj.get("shippingPrice")
            )
            if ship:
                result["shipping"] = ship.get("formatedAmount") if isinstance(ship, dict) else ship
            elif obj.get("freeShipping"):
                result["shipping"] = "Free Shipping"

        # Min order (Alibaba)
        if not result.get("min_order"):
            result["min_order"] = (
                obj.get("minOrder") or obj.get("moq") or obj.get("minOrderQuantity")
            )

        # Variants — decode skuPropIds using lookup map
        if not result.get("variants") and obj.get("skuPriceList"):
            variants = []
            for sku in obj["skuPriceList"]:
                raw_attr = sku.get("skuAttr") or sku.get("skuPropIds") or ""
                decoded: dict[str, str] = {}
                if raw_attr and prop_lookup:
                    for pair in raw_attr.split(";"):
                        entry = prop_lookup.get(pair.strip())
                        if entry:
                            decoded[entry["group"]] = entry["name"]
                val = sku.get("skuVal") or {}
                variants.append({
                    "id": str(sku.get("skuId") or sku.get("id") or ""),
                    "price": val.get("actSkuCalPrice") or val.get("skuCalPrice") or sku.get("price"),
                    "stock": val.get("availQuantity"),
                    "attributes": decoded if decoded else raw_attr,
                    "attributes_raw": raw_attr,
                })
            result["variants"] = variants

        if not result.get("variant_groups") and obj.get("productSKUPropertyList"):
            result["variant_groups"] = [
                {
                    "name": g.get("skuPropertyName", ""),
                    "values": [
                        {
                            "name": v.get("propertyValueDisplayName") or v.get("propertyValueName", ""),
                            "id": str(v.get("propertyValueId", "")),
                            "image": v.get("skuPropertyImagePath"),
                        }
                        for v in g.get("skuPropertyValues", [])
                    ],
                }
                for g in obj["productSKUPropertyList"]
            ]

        # Specifications
        if not result.get("specifications"):
            specs = obj.get("specifications") or obj.get("properties") or obj.get("attrList")
            if isinstance(specs, list):
                result["specifications"] = [
                    {
                        "name": s.get("name") or s.get("attrName") or s.get("key", ""),
                        "value": s.get("value") or s.get("attrValue") or s.get("val", ""),
                    }
                    for s in specs
                    if isinstance(s, dict)
                ]


def _build_prop_lookup(data: dict) -> dict:
    """Pre-build the SKU property lookup map from a JSON data tree."""
    lookup: dict[str, dict] = {}
    prop_list = (
        data.get("productSKUPropertyList")
        or (data.get("data") or {}).get("productSKUPropertyList")
        or ((data.get("data") or {}).get("product") or {}).get("productSKUPropertyList")
        or (data.get("skuModule") or {}).get("productSKUPropertyList")
    )
    if not isinstance(prop_list, list):
        return lookup
    for group in prop_list:
        group_name = group.get("skuPropertyName", "")
        group_id = group.get("skuPropertyId")
        for val in group.get("skuPropertyValues", []):
            val_id = val.get("propertyValueId")
            key = f"{group_id}:{val_id}"
            lookup[key] = {
                "group": group_name,
                "name": val.get("propertyValueDisplayName") or val.get("propertyValueName", ""),
                "image": val.get("skuPropertyImagePath"),
            }
    return lookup


# ---------------------------------------------------------------------------
# PRICE / WEIGHT / IMAGE HELPERS
# ---------------------------------------------------------------------------

_PRICE_RE = re.compile(r"[\$€£¥₹₩₽]?\s*([\d,]+\.?\d*)")
_WEIGHT_RE = re.compile(
    r"(?:weight|net\s*weight|package\s*weight)\s*[:=]\s*([\d.]+)\s*(kg|g|lb|oz)",
    re.IGNORECASE,
)
_UNIT_TO_KG = {"g": 0.001, "lb": 0.4536, "oz": 0.02835, "kg": 1.0}


def parse_price(text: str) -> Optional[float]:
    """Extract a numeric price from a text string."""
    if not text:
        return None
    m = _PRICE_RE.search(str(text).replace(",", ""))
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            pass
    return None


def normalise_weight_to_kg(text: str) -> Optional[float]:
    """Extract and normalise weight to kg from a free-form text block."""
    m = _WEIGHT_RE.search(text or "")
    if not m:
        return None
    value = float(m.group(1))
    unit = m.group(2).lower()
    kg = round(value * _UNIT_TO_KG.get(unit, 1.0), 4)
    return kg


def dedupe_images(images: list[str]) -> list[str]:
    """
    Deduplicate image URLs stripping http/https prefix.
    Filters out icons, SVGs, and tiny placeholder images.
    """
    seen: set[str] = set()
    out: list[str] = []
    for url in images:
        if not url or not isinstance(url, str):
            continue
        if url.startswith("//"):
            url = "https:" + url
        # Filter obviously wrong images
        if any(x in url.lower() for x in [".svg", "icon", "loading", "spinner", "placeholder", "logo"]):
            continue
        canon = re.sub(r"^https?:", "", url)
        if canon not in seen:
            seen.add(canon)
            out.append(url)
    return out[:20]


def extract_product_id_from_url(url: str) -> Optional[str]:
    """Extract a product ID from common e-commerce URL patterns."""
    patterns = [
        r"/item/(\d+)\.html",           # AliExpress product page
        r"/product-detail/[^_]*_(\d{5,})",  # Alibaba
        r"/offer/(\d+)",                # Alibaba offer
        r"[?&]id=(\d+)",
        r"/p/(\d+)",
        r"/product/(\d+)",
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None


def detect_currency(text: str) -> Optional[str]:
    """Detect currency code from a price string or page text snippet."""
    symbols = {"$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR",
               "₩": "KRW", "₽": "RUB", "A$": "AUD", "C$": "CAD"}
    for sym, code in symbols.items():
        if sym in (text or ""):
            return code
    m = re.search(r"\b(USD|EUR|GBP|CNY|JPY|INR|KRW|AUD|CAD|BRL|MXN|CHF|SEK|NOK|DKK|SGD|HKD)\b", text or "")
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# BASE SCRAPER CLASS
# ---------------------------------------------------------------------------

class BaseScraper:
    """
    Abstract base that all platform scrapers inherit from.
    Provides shared post-processing (weight, images, price parsing, etc.).
    """

    #: Ordered list of JSON start-marker patterns for this site
    JSON_PATTERNS: list[str] = []

    def scrape(self, url: str, **kwargs) -> dict:
        raise NotImplementedError

    def _post_process(self, result: dict, page_html: str = "") -> dict:
        """
        Apply common data clean-up steps after a scraper fills `result`.
        - Parse numeric prices
        - Normalise weight
        - Dedupe images
        - Auto-detect currency
        - Truncate short description
        """
        # Prices → float where possible
        for field in ("price", "original_price"):
            val = result.get(field)
            if isinstance(val, str):
                parsed = parse_price(val)
                if parsed is not None:
                    result[field] = parsed

        # Weight from page body text
        if not result.get("weight") and page_html:
            w = normalise_weight_to_kg(page_html[:50_000])
            if w:
                result["weight"] = w
                result["weight_unit"] = "kg"

        # Images — dedupe + clean
        result["images"] = dedupe_images(result.get("images") or [])

        # Currency detection
        if not result.get("currency") and result.get("price"):
            result["currency"] = detect_currency(str(result["price"])) or "USD"

        # Short description
        if not result.get("short_description") and result.get("description"):
            plain = re.sub(r"<[^>]+>", " ", str(result["description"]))
            plain = re.sub(r"\s+", " ", plain).strip()
            if len(plain) > 200:
                cut = plain[:200]
                last_space = cut.rfind(" ")
                result["short_description"] = plain[:last_space] + "…"
            else:
                result["short_description"] = plain

        result["extracted_at"] = int(time.time() * 1000)
        return result
