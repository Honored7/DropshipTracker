"""
/search — Keyword search endpoint.

POST /search
Body: { "query": "wireless earbuds", "site": "aliexpress", "max_results": 20 }

Scrapes the search results page for the requested site and returns a list of
product summaries (title, price, image, URL, rating).
"""

from __future__ import annotations

import logging
import re
from typing import Optional
from urllib.parse import quote_plus

from fastapi import APIRouter

from ..models.product import SearchRequest, SearchResponse, SearchResultItem

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/search", response_model=SearchResponse, summary="Search for products")
async def search_products(req: SearchRequest):
    """
    Search for products on a supported supplier site.

    - **query** — Search keywords
    - **site** — ``"aliexpress"`` or ``"alibaba"`` (default aliexpress)
    - **max_results** — Maximum number of results to return (default 20)
    - **min_price** / **max_price** — Optional price filter

    Returns a list of product summaries.
    """
    if req.site == "alibaba":
        return await _search_alibaba(req)
    return await _search_aliexpress(req)


# ---------------------------------------------------------------------------
# AliExpress search
# ---------------------------------------------------------------------------

async def _search_aliexpress(req: SearchRequest) -> SearchResponse:
    try:
        from scrapling.fetchers import StealthyFetcher

        q = quote_plus(req.query)
        url = f"https://www.aliexpress.com/wholesale?SearchText={q}&sortType=total_transSold_desc"

        page = StealthyFetcher.fetch(url, headless=True, network_idle=True, disable_resources=False)
        items = _parse_aliexpress_results(page, req.max_results, req.min_price, req.max_price)
        return SearchResponse(
            query=req.query,
            site="aliexpress",
            results=items,
            total_found=len(items),
        )
    except Exception as exc:
        logger.exception("[/search] AliExpress search failed for %r", req.query)
        return SearchResponse(
            query=req.query, site="aliexpress", results=[], total_found=0, error=str(exc)
        )


def _parse_aliexpress_results(
    page,
    max_results: int,
    min_price: Optional[float],
    max_price: Optional[float],
) -> list[SearchResultItem]:
    items: list[SearchResultItem] = []

    # AliExpress search cards use several class naming conventions over time;
    # adaptive=False here because this should match multiple elements.
    card_selectors = [
        '[class*="SearchItem"]',
        'a[class*="item-title"]',
        ".list--gallery--C2f2tvm",
        ".search-item-card-anchor-link",
        ".JIIxO",
    ]

    cards = []
    for sel in card_selectors:
        try:
            found = page.css(sel)
            if found and hasattr(found, "__iter__"):
                card_list = list(found)
                if card_list:
                    cards = card_list
                    break
        except Exception:
            pass

    # If no cards found, try a generic product link heuristic
    if not cards:
        try:
            cards = [el for el in page.css("a[href*='/item/']") if el]
        except Exception:
            pass

    for card in cards[:max_results]:
        try:
            # URL
            href = card.attrib.get("href") or ""
            if not href.startswith("http"):
                href = "https:" + href if href.startswith("//") else "https://www.aliexpress.com" + href

            # Title
            title_el = (
                card.css("[class*='title']") or card.css("h3") or card.css("a")
            )
            title = title_el.get_text(strip=True) if title_el else None

            # Price
            price_raw = None
            for price_sel in ["[class*='price']", "[class*='Price']"]:
                try:
                    price_el = card.css(price_sel)
                    if price_el:
                        price_raw = price_el.get_text(strip=True)
                        break
                except Exception:
                    pass
            price_val = _parse_price_from_text(price_raw)

            # Price filter
            if price_val is not None:
                if min_price and price_val < min_price:
                    continue
                if max_price and price_val > max_price:
                    continue

            # Image
            img_el = card.css("img")
            img_src = None
            if img_el:
                img_src = img_el.attrib.get("src") or img_el.attrib.get("data-src")
                if img_src and img_src.startswith("//"):
                    img_src = "https:" + img_src

            # Rating / sold
            rating_el = card.css("[class*='rating'], [class*='Rating']")
            rating = None
            if rating_el:
                m = re.search(r"([\d.]+)", rating_el.get_text(strip=True))
                if m:
                    rating = float(m.group(1))

            sold_el = card.css("[class*='sold'], [class*='orders']")
            sold = None
            if sold_el:
                m = re.search(r"([\d,]+)", sold_el.get_text(strip=True))
                if m:
                    sold = int(m.group(1).replace(",", ""))

            if href and (title or price_val):
                items.append(
                    SearchResultItem(
                        title=title,
                        url=href,
                        price=price_val,
                        image=img_src,
                        rating=rating,
                        sold_count=sold,
                    )
                )
        except Exception:
            continue

    return items


# ---------------------------------------------------------------------------
# Alibaba search
# ---------------------------------------------------------------------------

async def _search_alibaba(req: SearchRequest) -> SearchResponse:
    try:
        from scrapling.fetchers import DynamicFetcher

        q = quote_plus(req.query)
        url = f"https://www.alibaba.com/trade/search?SearchText={q}&IndexArea=product_en"

        page = DynamicFetcher.fetch(url, headless=True, network_idle=True)
        items = _parse_alibaba_results(page, req.max_results, req.min_price, req.max_price)
        return SearchResponse(
            query=req.query,
            site="alibaba",
            results=items,
            total_found=len(items),
        )
    except Exception as exc:
        logger.exception("[/search] Alibaba search failed for %r", req.query)
        return SearchResponse(
            query=req.query, site="alibaba", results=[], total_found=0, error=str(exc)
        )


def _parse_alibaba_results(
    page,
    max_results: int,
    min_price: Optional[float],
    max_price: Optional[float],
) -> list[SearchResultItem]:
    items: list[SearchResultItem] = []

    card_selectors = [
        ".organic-list-offer-outter",
        ".offer-item",
        '[class*="product-offer"]',
        ".list-item",
    ]

    cards = []
    for sel in card_selectors:
        try:
            found = page.css(sel)
            if found and hasattr(found, "__iter__"):
                card_list = list(found)
                if card_list:
                    cards = card_list
                    break
        except Exception:
            pass

    for card in cards[:max_results]:
        try:
            # URL / Title
            link_el = card.css("a[href*='product-detail'], a[href*='offer']")
            href = (link_el.attrib.get("href") or "") if link_el else ""
            if href and not href.startswith("http"):
                href = "https:" + href if href.startswith("//") else "https://www.alibaba.com" + href
            title = (
                card.css("h2").get_text(strip=True)
                or (link_el.get_text(strip=True) if link_el else None)
            )

            # Price
            price_el = card.css("[class*='price'] .price-main, [class*='price-value'], .price")
            price_raw = price_el.get_text(strip=True) if price_el else None
            price_val = _parse_price_from_text(price_raw)

            if price_val:
                if min_price and price_val < min_price:
                    continue
                if max_price and price_val > max_price:
                    continue

            img_el = card.css(".main-img img, img")
            img_src = None
            if img_el:
                img_src = img_el.attrib.get("src") or img_el.attrib.get("data-lazy-src")
                if img_src and img_src.startswith("//"):
                    img_src = "https:" + img_src

            moq_el = card.css("[class*='moq'], [class*='min-order']")
            store_el = card.css("[class*='company-name'], [class*='supplier']")

            if href or title:
                items.append(
                    SearchResultItem(
                        title=title,
                        url=href,
                        price=price_val,
                        image=img_src,
                        store_name=(store_el.get_text(strip=True) if store_el else None),
                    )
                )
        except Exception:
            continue

    return items


# ---------------------------------------------------------------------------
# Shared helper
# ---------------------------------------------------------------------------

def _parse_price_from_text(text: Optional[str]) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"[\d,]+\.?\d*", text.replace(",", ""))
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            pass
    return None
