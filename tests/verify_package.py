"""Validate exported book archives with the ZIP and hashing standard libraries."""
import hashlib
import io
import json
import mimetypes
import sys
import zipfile

with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    manifest = json.loads(archive.read('manifest.json'))
    assert manifest['files']
    for entry in manifest['files']:
        content = archive.read(entry['path'])
        assert len(content) == entry['sizeBytes'], entry['path']
        assert entry['sha256'] == 'sha256:'+hashlib.sha256(content).hexdigest(), entry['path']
        assert entry['mimeType'] == mimetypes.guess_type(entry['path'])[0], entry['path']
