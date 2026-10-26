# syntax=docker/dockerfile:1
# The app needs only the Python standard library (serve.py, build.py) and Node
# (the tests), so nothing else is installed. The project folder is mounted at
# /work at run time and is never copied into the image.
FROM python:3.14-slim-trixie
COPY --from=node:24-trixie-slim /usr/local/bin/node /usr/local/bin/node
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /work
CMD ["bash"]
