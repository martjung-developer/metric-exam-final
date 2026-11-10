#!/usr/bin/env python3
"""Loopback-only adapter for the repository's existing questionnaire parser."""

import json
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import parse_questionnaire as parser

MAX_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".docx", ".pdf"}


class ParserHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/parse" or self.client_address[0] not in {"127.0.0.1", "::1"}:
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(400, {"error": "Invalid upload."})
            return
        if length <= 0 or length > MAX_BYTES:
            self._json(413 if length > MAX_BYTES else 400, {"error": "Invalid upload."})
            return

        extension = self.headers.get("X-File-Extension", "").lower()
        if extension not in ALLOWED_EXTENSIONS:
            self._json(415, {"error": "Unsupported file type."})
            return

        data = self.rfile.read(length)
        if len(data) != length:
            self._json(400, {"error": "Invalid upload."})
            return

        expected = b"PK\x03\x04" if extension == ".docx" else b"%PDF-"
        if not data.startswith(expected):
            self._json(415, {"error": "Unsupported file type."})
            return

        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as temp_file:
                temp_file.write(data)
                temp_file.flush()
                temp_path = Path(temp_file.name)
            if extension == ".docx":
                result = {"rows": parser.parse_docx(temp_path)}
            else:
                with parser.fitz.open(str(temp_path)) as document:
                    text = "\n".join(page.get_text("text", sort=True) for page in document)
                result = {"rows": parser.parse_pdf(temp_path), "text": text}
            self._json(200, result)
        except Exception:
            self._json(422, {"error": "Could not parse this file."})
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

    def _json(self, status, value):
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 8765), ParserHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
