# Repository attribution

Every published commit must use `ronda-agent[bot]` as both author and committer,
with email `330417223+ronda-agent[bot]@users.noreply.github.com`.
Do not add another identity in a `Co-Authored-By` trailer.
Configure identity per repository, never globally, and run
`python3 scripts/check-git-identity.py HEAD` before pushing.

Create and manage pull requests through the Ronda GitHub App installation:
`python3 scripts/with-ronda-agent.py pr create ...`.
The helper uses the ignored local App key, or `RONDA_APP_PRIVATE_KEY`.
If App authentication fails, stop; never substitute a personal GitHub account.
Pushes must also authenticate as the Ronda App.
Merge locally with the bot identity and push with App authentication, so both
author and committer stay correct; GitHub's merge API uses a platform committer.

After a history migration, start from current remote refs. Never push backup
bundles, old tags, or old branches into this repository.
