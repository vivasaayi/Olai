#!/usr/bin/env python3
"""Verify full-stack worktree isolation and persistent storage in the stable adapter."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid

root = Path(__file__).resolve().parent.parent
fixture = Path(tempfile.mkdtemp(prefix='olai-isolation-'))
worktrees = [fixture/'first', fixture/'second']
plans = []
expected_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()


def run(args, cwd=root, capture=False, env=None):
    if capture:
        return subprocess.check_output(args, cwd=cwd, text=True, env=env)
    subprocess.run(args, cwd=cwd, check=True, env=env)


def call(base, path, method='GET', value=None, expected_status=200):
    request = urllib.request.Request(
        base+path,
        method=method,
        data=None if value is None else json.dumps(value).encode(),
        headers={'Content-Type': 'application/json'},
    )
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        assert error.code == expected_status, (path, error.code, expected_status)
        return None
    with response:
        assert response.status == expected_status
        if 'application/json' in response.headers.get('Content-Type', ''):
            return json.load(response)
        return response.read()


def seed_library(base, name):
    call(base, '/api/books/'+name, 'PUT', {'id': name, 'title': name})
    call(base, '/api/translations/'+name, 'PUT', {
        'id': name,
        'title': name,
        'translations': [{'pageNumber': 1, 'language': 'ta', 'paragraphs': ['தமிழ்']}],
    })
    call(base, '/api/assets/'+name, 'PUT', {
        'bookId': name,
        'fileName': 'source.pdf',
        'mimeType': 'application/pdf',
        'base64': base64.b64encode(('%PDF-'+name).encode()).decode(),
    })


def assert_library(base, name):
    assert call(base, '/api/books/'+name)['title'] == name
    assert call(base, '/api/translations/'+name)['translations'][0]['paragraphs'] == ['தமிழ்']
    assert call(base, '/api/assets/'+name) == ('%PDF-'+name).encode()
    assert call(base, '/health')['commit'] == expected_commit


def app_container(project):
    ids = run([
        'docker', 'ps', '-q', '--filter', f'label=com.docker.compose.project={project}',
        '--filter', 'label=com.docker.compose.service=app',
    ], capture=True).split()
    assert len(ids) == 1, ids
    return json.loads(run(['docker', 'inspect', ids[0]], capture=True))[0]


def stable_adapter_rehearsal(image):
    # Exercise the actual staging Compose file using an ephemeral test project and dynamic port.
    # This keeps the user-controlled staging deployment after merge.
    project = 'olai-staging-rehearsal-'+uuid.uuid4().hex[:12]
    environment = {
        **os.environ,
        'APP_IMAGE': image,
        'APP_PORT': '8080',
        'BIND_ADDRESS': '127.0.0.1',
        'PUBLISHED_PORT': '0',
    }
    command = [
        'docker', 'compose', '--project-name', project,
        '--project-directory', str(root), '-f', str(root/'deploy/compose.staging.yaml'),
    ]
    try:
        run(command+['run', '--rm', 'app', 'migrate'], env=environment)
        run(command+['up', '-d', '--wait'], env=environment)
        first = app_container(project)
        assert first['Image'] == image
        binding = first['NetworkSettings']['Ports']['8080/tcp'][0]
        base = 'http://'+binding['HostIp']+':'+binding['HostPort']
        seed_library(base, 'stable-restart')
        run(command+['down'], env=environment)
        run(command+['run', '--rm', 'app', 'migrate'], env=environment)
        run(command+['up', '-d', '--wait'], env=environment)
        second = app_container(project)
        assert second['Image'] == image
        binding = second['NetworkSettings']['Ports']['8080/tcp'][0]
        base = 'http://'+binding['HostIp']+':'+binding['HostPort']
        assert_library(base, 'stable-restart')
        print('PASS staging adapter rehearsal with recorded image and persistent books, translations and PDFs')
    finally:
        run(command+['down', '--volumes', '--remove-orphans'], env=environment)


try:
    for worktree in worktrees:
        run(['git', 'worktree', 'add', '--detach', str(worktree), 'HEAD'])
        plan = json.loads(run(['bash', 'scripts/env', 'worktree', 'plan'], worktree, True))
        plans.append(plan)
        run(['bash', 'scripts/env', 'worktree', 'up'], worktree)
    urls = [run(['python3', 'scripts/endpoint'], worktree, True).strip() for worktree in worktrees]
    assert plans[0]['project'] != plans[1]['project']
    assert urls[0] != urls[1]
    containers = [app_container(plan['project']) for plan in plans]
    volumes = []
    for plan, container in zip(plans, containers):
        env_path = Path(plan['state'])/'environment.env'
        assert env_path.stat().st_mode & 0o077 == 0
        mounts = [mount for mount in container['Mounts'] if mount['Destination'] == '/data']
        assert len(mounts) == 1 and mounts[0]['Type'] == 'volume'
        assert mounts[0]['Name'].startswith(plan['project']+'_')
        volumes.append(mounts[0]['Name'])
    assert volumes[0] != volumes[1]
    seed_library(urls[0], 'first-only')
    seed_library(urls[1], 'second-only')
    for base, other in [(urls[0], 'second-only'), (urls[1], 'first-only')]:
        for collection in ['books', 'translations', 'assets']:
            call(base, f'/api/{collection}/{other}', expected_status=404)
    assert_library(urls[0], 'first-only')
    assert_library(urls[1], 'second-only')
    run(['bash', 'scripts/env', 'worktree', 'destroy'], worktrees[0])
    assert_library(urls[1], 'second-only')
    run(['bash', 'scripts/env', 'worktree', 'stop'], worktrees[1])
    run(['bash', 'scripts/env', 'worktree', 'up'], worktrees[1])
    second_url = run(['python3', 'scripts/endpoint'], worktrees[1], True).strip()
    assert_library(second_url, 'second-only')
    samples = [book for book in call(second_url, '/api/books') if book['id'] == 'sample-authoring']
    assert len(samples) == 1
    stable_adapter_rehearsal(app_container(plans[1]['project'])['Image'])
    print('PASS isolated worktree projects, ports, private configuration, volumes and full libraries; independent destruction; retryable migrations and seeds')
finally:
    for worktree in worktrees:
        if worktree.exists():
            run(['bash', 'scripts/env', 'worktree', 'destroy'], worktree)
            run(['git', 'worktree', 'remove', '--force', str(worktree)])
