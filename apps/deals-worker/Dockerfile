FROM python:3.11-slim

# Ensure Python output is not buffered
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src ./src

# Create non-root user
RUN useradd --create-home --shell /bin/bash app
RUN chown -R app:app /app
USER app

EXPOSE 8008

# Health check - just verify the process is running since there's no HTTP server
# (python:3.11-slim has no pgrep; the worker is PID 1)
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD grep -q "src/index.py" /proc/1/cmdline || exit 1

CMD ["python", "src/index.py"]