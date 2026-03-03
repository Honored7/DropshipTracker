# DropshipTracker backend Docker image
# Installs Scrapling + all browsers in a single reproducible container.
# Build:  docker build -t dropshiptracker-backend .
# Run:    docker run -p 8000:8000 dropshiptracker-backend

FROM python:3.12-slim

# System deps for Playwright / Camoufox browsers
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl ca-certificates gnupg unzip \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libx11-6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (cached layer)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Scrapling browsers (Playwright + Camoufox)
RUN scrapling install

# Copy project
COPY . .

ENV PORT=8000
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
