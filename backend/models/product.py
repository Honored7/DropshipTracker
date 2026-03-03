"""
Pydantic data models for extracted product data.
Used as the contract between scrapers, the API layer, and the Chrome extension.
"""

from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, HttpUrl, field_validator


class VariantValue(BaseModel):
    name: str
    id: Optional[str] = None
    image: Optional[str] = None


class VariantGroup(BaseModel):
    name: str
    values: list[VariantValue] = []


class Variant(BaseModel):
    id: Optional[str] = None
    price: Optional[str | float] = None
    stock: Optional[int] = None
    attributes: dict[str, str] | str = {}
    attributes_raw: Optional[str] = None


class Specification(BaseModel):
    name: str
    value: str


class Review(BaseModel):
    author: Optional[str] = None
    rating: Optional[float | int] = None
    date: Optional[str] = None
    text: Optional[str] = None
    country: Optional[str] = None
    images: list[str] = []


class ProductResult(BaseModel):
    """
    Unified product data structure returned by every scraper and the API.
    All fields are optional — scrapers fill what they can find.
    """
    # Identity
    product_id: Optional[str] = None
    url: str
    domain: str
    extracted_at: Optional[int] = None   # Unix ms timestamp
    source: str = "backend"              # "backend" | "extension"
    scraper: Optional[str] = None        # "aliexpress" | "alibaba" | "generic"
    extraction_method: Optional[str] = None  # "json" | "css" | "api"

    # Core fields
    title: Optional[str] = None
    price: Optional[str | float] = None
    original_price: Optional[str | float] = None
    currency: Optional[str] = None
    description: Optional[str] = None
    short_description: Optional[str] = None
    meta_description: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None

    # Images & media
    images: list[str] = []
    video_urls: list[str] = []

    # Stock & logistics
    stock: Optional[int] = None
    availability: Optional[str] = None
    shipping: Optional[str] = None
    shipping_cost: Optional[float] = None
    min_order: Optional[str | int] = None
    weight: Optional[float] = None
    weight_unit: Optional[str] = None

    # Seller
    store_name: Optional[str] = None
    store_url: Optional[str] = None
    store_rating: Optional[float | str] = None

    # Social proof
    rating: Optional[float] = None
    review_count: Optional[int] = None
    sold_count: Optional[int] = None
    orders: Optional[int] = None

    # Variants & specs
    variants: list[Variant] = []
    variant_groups: list[VariantGroup] = []
    specifications: list[Specification] = []

    # Reviews (captured separately)
    reviews: list[Review] = []

    # Raw / debug
    raw_json: Optional[dict[str, Any]] = None


class ExtractRequest(BaseModel):
    url: str
    use_stealth: bool = True       # Use StealthyFetcher (bypasses Cloudflare)
    use_dynamic: bool = False      # Force DynamicFetcher even for non-dynamic sites
    save_selectors: bool = True    # Persist Scrapling adaptive selector fingerprints
    include_reviews: bool = False  # Fetch reviews page (slower)
    include_raw: bool = False      # Include raw_json in response


class SearchRequest(BaseModel):
    query: str
    site: str = "aliexpress"       # "aliexpress" | "alibaba"
    max_results: int = 20
    min_price: Optional[float] = None
    max_price: Optional[float] = None


class SearchResultItem(BaseModel):
    title: Optional[str] = None
    url: str
    price: Optional[str | float] = None
    original_price: Optional[str | float] = None
    currency: Optional[str] = None
    image: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    sold_count: Optional[int] = None
    store_name: Optional[str] = None


class SearchResponse(BaseModel):
    query: str
    site: str
    results: list[SearchResultItem] = []
    total_found: int = 0
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    scrapling_version: Optional[str] = None
