FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    python3 \
    python3-pip \
    python3-venv \
    tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY requirements.txt ./
RUN python3 -m venv .venv \
  && .venv/bin/python -m pip install --no-cache-dir --upgrade pip \
  && .venv/bin/python -m pip install --no-cache-dir -r requirements.txt

COPY src ./src

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV PYTHON_BIN=/app/.venv/bin/python
ENV FFMPEG_PATH=ffmpeg

EXPOSE 8787

CMD ["npm", "start"]
