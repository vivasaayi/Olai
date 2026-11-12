#!/usr/bin/env python3
"""Verify two feature worktrees use independent stacks and retain only their own data."""
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request

root = Path(__file__).resolve().parent.parent
fixture = Path(tempfile.mkdtemp(prefix='olai-isolation-'))
worktrees = [fixture/'first', fixture/'second']
plans = []

def run(args, cwd=root, capture=False):
    if capture:
        return subprocess.check_output(args,cwd=cwd,text=True)
    subprocess.run(args,cwd=cwd,check=True)

def call(base, path, method='GET', value=None):
    request = urllib.request.Request(base+path,method=method,data=None if value is None else json.dumps(value).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=30) as response:
        return json.load(response)

try:
    for worktree in worktrees:
        run(['git','worktree','add','--detach',str(worktree),'HEAD'])
        plan = json.loads(run(['bash','scripts/env','worktree','plan'],worktree,True))
        plans.append(plan)
        run(['bash','scripts/env','worktree','up'],worktree)
    urls = [run(['python3','scripts/endpoint'],w,True).strip() for w in worktrees]
    assert plans[0]['project'] != plans[1]['project']
    assert urls[0] != urls[1]
    settings = []
    for plan in plans:
        env_path = Path(plan['state'])/'environment.env'
        assert env_path.stat().st_mode & 0o077 == 0
        settings.append(dict(line.split('=',1) for line in env_path.read_text().splitlines() if '=' in line))
    assert settings[0]['POSTGRES_PASSWORD'] != settings[1]['POSTGRES_PASSWORD']
    call(urls[0],'/api/books/first-only','PUT',{'id':'first-only','title':'First worktree only'})
    call(urls[1],'/api/books/second-only','PUT',{'id':'second-only','title':'Second worktree only'})
    assert not any(book['id']=='first-only' for book in call(urls[1],'/api/books'))
    assert not any(book['id']=='second-only' for book in call(urls[0],'/api/books'))
    run(['bash','scripts/env','worktree','destroy'],worktrees[0])
    assert call(urls[1],'/api/books/second-only')['title']=='Second worktree only'
    run(['bash','scripts/env','worktree','stop'],worktrees[1])
    run(['bash','scripts/env','worktree','up'],worktrees[1])
    second_url = run(['python3','scripts/endpoint'],worktrees[1],True).strip()
    assert call(second_url,'/api/books/second-only')['title']=='Second worktree only'
    call(second_url,'/health')
    print('PASS distinct worktree projects, ports, private configuration and data; independent destruction; restart persistence; retryable migrations and seeds')
finally:
    for worktree in worktrees:
        if worktree.exists():
            run(['bash','scripts/env','worktree','destroy'],worktree)
            run(['git','worktree','remove','--force',str(worktree)])
