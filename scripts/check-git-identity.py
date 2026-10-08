#!/usr/bin/env python3
"""Reject commits attributed to any identity other than the Ronda App."""
import re
import subprocess
import sys

NAME = 'ronda-agent[bot]'
EMAIL = '330417223+ronda-agent[bot]@users.noreply.github.com'

def valid(identity):
    return identity == f'{NAME} <{EMAIL}>'

def errors(refs):
    output = subprocess.check_output([
        'git', 'log', '--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x00', *refs,
    ], text=True)
    fields = output.split('\0')
    failures = []
    for start in range(0, len(fields) - 1, 4):
        sha, author, committer, message = fields[start:start + 4]
        sha = sha.strip()
        if not valid(author) or not valid(committer):
            failures.append(f'{sha[:12]} has an unexpected author or committer')
        for trailer in re.findall(r'^Co-authored-by:\s*(.+)$', message, re.M | re.I):
            if not valid(trailer.strip()):
                failures.append(f'{sha[:12]} has an unexpected co-author')
    return failures

if __name__ == '__main__':
    if sys.argv[1:] == ['--working-identity']:
        failures = []
        for field in ('AUTHOR', 'COMMITTER'):
            identity = subprocess.check_output(['git', 'var', f'GIT_{field}_IDENT'], text=True).strip()
            if not valid(identity.rsplit('> ', 1)[0] + '>'):
                failures.append(f'Configure the Ronda bot as Git {field.lower()} before committing.')
    else:
        failures = errors(sys.argv[1:] or ['HEAD'])
    if failures:
        print('\n'.join(failures), file=sys.stderr)
        sys.exit(1)
    print('All commit identities belong to ronda-agent[bot].')
