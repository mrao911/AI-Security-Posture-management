# Daily Cybersecurity LinkedIn Post — Claude Code edition

A Python re-implementation of the `Daily Cybersecurity LinkedIn Post` n8n
workflow, built directly on the Anthropic SDK so it can run anywhere Python and
`cron` (or a Claude Code / CI schedule) can — no n8n instance required.

Same three-agent pipeline, same human-in-the-loop guarantee:

| Stage | n8n node | Here |
|-------|----------|------|
| Research | `Call Claude - Research` (+ web search) | `run_research()` — Claude `web_search_20260209` tool |
| Write | `Call Claude - Writer` | `run_writer()` |
| Edit / compliance | `Call Claude - Editor` | `run_editor()` |
| Approval gate | Email Approve/Reject links + `Wait` node | terminal prompt (or `--yes` for headless) |
| Publish | `Post to LinkedIn` node | `post_to_linkedin()` — LinkedIn REST API |

The model is `claude-opus-4-8` with adaptive thinking. Nothing is posted to
LinkedIn without an explicit approval; by default the pipeline only writes the
finished post to `posts/<date>.post.txt`.

## Setup

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...

# Optional — tells the writer whose voice to use (maps to YOUR_NAME / YOUR_COMPANY)
export AUTHOR_NAME="Jane Doe"
export AUTHOR_COMPANY="Acme Security"
```

## Run

```bash
# Research -> write -> edit -> save draft (no publishing)
python daily_cyber_linkedin.py

# ...then prompt to publish to LinkedIn
python daily_cyber_linkedin.py --post

# Fully headless (for cron) — auto-approves publishing
python daily_cyber_linkedin.py --post --yes

# Reuse an existing brief instead of re-researching
python daily_cyber_linkedin.py --brief posts/2026-07-06.brief.json --post
```

Each run writes three files to `posts/<date>.*`: the intel `brief.json`, the
publish-ready `post.txt`, and the editor's `review.json` (verdict + the
"less than 95% sure" notes for your final glance).

## Publishing to LinkedIn

`--post` needs two secrets from a LinkedIn app with the `w_member_social` scope:

```bash
export LINKEDIN_ACCESS_TOKEN=...            # OAuth2 access token
export LINKEDIN_AUTHOR_URN=urn:li:person:XXXXXXXX   # or urn:li:organization:XXXX
```

## Schedule it (the "Daily 06:00" trigger)

```cron
0 6 * * *  cd /path/to/claude-code-workflow && \
           /usr/bin/python daily_cyber_linkedin.py --post --yes >> run.log 2>&1
```

Prefer to keep a human in the loop even when scheduled? Drop `--yes`: the run
writes the draft and exits without publishing, and you publish approved drafts
later with `--brief posts/<date>.brief.json --post`.

## Notes / safety

- Defensive guidance only — the research and editor prompts forbid exploitation
  detail and require CVE/score/vendor claims to trace to a cited source.
- The research agent cross-checks against ≥2 sources and labels unconfirmed
  details, mirroring the n8n prompts.
- Web search runs server-side; the script handles the `pause_turn`
  continuation loop automatically.
