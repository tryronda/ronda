#!/usr/bin/env python3
"""Run gh using a Ronda App installation token, never a personal fallback."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

def app_token():
    root = Path(__file__).resolve().parents[1]
    key = Path(os.environ.get('RONDA_APP_PRIVATE_KEY', str(root / 'ronda-agent.2026-09-17.private-key.pem')))
    if not key.is_file():
        raise RuntimeError('Set RONDA_APP_PRIVATE_KEY to the Ronda App private key file.')
    def b64(data):
        return base64.urlsafe_b64encode(data).rstrip(b'=')
    now = int(time.time())
    signing = b'.'.join([
        b64(json.dumps({'alg':'RS256','typ':'JWT'}).encode()),
        b64(json.dumps({'iat':now-60,'exp':now+540,'iss':'4977351'}).encode()),
    ])
    signature = subprocess.check_output(['openssl','dgst','-sha256','-sign',str(key)], input=signing)
    jwt = (signing + b'.' + b64(signature)).decode()
    request = urllib.request.Request(
        'https://api.github.com/app/installations/162467313/access_tokens',
        data=json.dumps({'repositories':['ronda']}).encode(), method='POST',
        headers={'Authorization':'Bearer '+jwt,'Accept':'application/vnd.github+json',
                 'Content-Type':'application/json','User-Agent':'ronda-agent'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if result.get('permissions', {}).get('pull_requests') != 'write':
        raise RuntimeError('Ronda App token lacks pull request write permission.')
    return result['token']

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('Usage: python3 scripts/with-ronda-agent.py <gh arguments>')
    try:
        token = app_token()
    except (RuntimeError, OSError, urllib.error.URLError, subprocess.CalledProcessError) as error:
        sys.exit(f'Ronda App authentication failed: {error}')
    environment = os.environ.copy()
    environment.update(GH_TOKEN=token, GITHUB_TOKEN=token)
    sys.exit(subprocess.call(['gh', *sys.argv[1:]], env=environment))
