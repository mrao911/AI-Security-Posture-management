#!/usr/bin/env python3
"""Daily Cybersecurity LinkedIn Post — Claude Code / Anthropic SDK edition.

A three-agent pipeline that mirrors the n8n workflow of the same name:

    1. Research  – Claude + web search finds the single most significant
                   cybersecurity development of the last 24-48h and returns a
                   structured intel brief (JSON).
    2. Writer    – Turns the brief into a LinkedIn post draft.
    3. Editor    – Fact-checks the draft against the brief for accuracy,
                   safety, legal, and brand, fixing issues in place.

A human approval gate sits between the editor and publishing — nothing is
posted to LinkedIn without an explicit "yes". By default the pipeline just
writes the final post to disk for review.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    python daily_cyber_linkedin.py                 # research -> write -> edit -> save draft
    python daily_cyber_linkedin.py --post          # ...then prompt to publish
    python daily_cyber_linkedin.py --post --yes     # auto-approve (for cron)
    python daily_cyber_linkedin.py --brief brief.json   # skip research, reuse a brief

Publishing requires LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN (see README).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from typing import Any

import anthropic

MODEL = "claude-opus-4-8"
OUTPUT_DIR = Path(os.environ.get("CYBER_OUTPUT_DIR", "posts"))

# --- Ghostwriter identity -------------------------------------------------
# Edit these two values (or set the env vars) so the writer knows whose voice
# to use. They map to YOUR_NAME / YOUR_COMPANY in the n8n version.
AUTHOR_NAME = os.environ.get("AUTHOR_NAME", "YOUR_NAME")
AUTHOR_COMPANY = os.environ.get("AUTHOR_COMPANY", "YOUR_COMPANY")


# --------------------------------------------------------------------------
# Claude helpers
# --------------------------------------------------------------------------
def _text_of(message: anthropic.types.Message) -> str:
    """Join all text blocks of a response (tool responses interleave blocks)."""
    return "\n".join(b.text for b in message.content if b.type == "text")


def _extract_json(text: str) -> dict[str, Any]:
    """Pull the first complete JSON object out of a model response."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"Model did not return JSON: {text[:300]}")
    return json.loads(text[start : end + 1])


def call_claude(client: anthropic.Anthropic, system: str, user: str,
                max_tokens: int = 2000) -> dict[str, Any]:
    """One-shot JSON call — used for the writer and editor stages."""
    with client.messages.stream(
        model=MODEL,
        max_tokens=max_tokens,
        thinking={"type": "adaptive"},
        system=system,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        message = stream.get_final_message()
    return _extract_json(_text_of(message))


def run_research(client: anthropic.Anthropic, today: str) -> dict[str, Any]:
    """Research stage — Claude with the web-search server tool.

    Web search runs a server-side sampling loop; when it hits the internal
    iteration cap the response comes back with stop_reason == "pause_turn"
    and we resend to let it continue.
    """
    system = (
        "You are a senior threat intelligence analyst producing a daily brief "
        "for a cybersecurity content company.\n\n"
        "TASK: Search the web and identify the single most significant "
        "cybersecurity development of the last 24-48 hours. Prioritize: "
        "(1) actively exploited vulnerabilities / CISA KEV additions / zero-days, "
        "(2) major breaches, ransomware or APT campaigns, "
        "(3) threats to emerging tech (AI/LLM security, cloud-native, IoT/OT, supply chain).\n\n"
        "PRIORITIZED SOURCES: CISA, NVD/MITRE, Microsoft MSRC, Unit 42, Mandiant, "
        "Google TAG, BleepingComputer, The Hacker News, Krebs on Security, SANS ISC. "
        "Cross-check claims against at least 2 sources.\n\n"
        "RULES: Never invent CVE numbers, CVSS scores or vendor statements. Label "
        "unconfirmed details as reported/unconfirmed. Mitigations must be defensive "
        "only (patching, hardening, detection) - never exploitation guidance.\n\n"
        "OUTPUT: respond ONLY with valid JSON, no markdown fences, exactly this shape:\n"
        '{"date":"...","headline":"...","summary":"150 words max, factual",'
        '"cve_ids":["..."],"severity":"critical|high|medium","affected":"...",'
        '"risks":["..."],"mitigations":["step 1","step 2","step 3"],'
        '"emerging_tech_angle":"... or null","sources":["url1","url2"]}'
    )

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": f"Today is {today}. Produce the daily brief."}
    ]
    tools = [{"type": "web_search_20260209", "name": "web_search"}]

    for _ in range(6):  # bound the pause_turn continuations
        with client.messages.stream(
            model=MODEL,
            max_tokens=4000,
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            system=system,
            tools=tools,
            messages=messages,
        ) as stream:
            message = stream.get_final_message()

        if message.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": message.content})
            continue
        return _extract_json(_text_of(message))

    raise RuntimeError("Research stage did not converge after 6 continuations")


def run_writer(client: anthropic.Anthropic, brief: dict[str, Any]) -> dict[str, Any]:
    system = (
        f"You are the LinkedIn ghostwriter for {AUTHOR_NAME}, founder of "
        f"{AUTHOR_COMPANY}, a cybersecurity consultancy. Voice: expert but "
        "plain-spoken, practitioner-to-practitioner, zero hype, no fear-mongering.\n\n"
        "TASK: write ONE LinkedIn post about the story in the provided intel brief.\n\n"
        "FORMAT: hook line (first 8-12 words earn the see-more click, lead with "
        "impact not the CVE number); 2-3 short paragraphs: what happened -> why it "
        "matters to businesses -> 3 concrete numbered mitigation steps; close with "
        "one engagement question; 3-5 hashtags; 1100-1600 characters; blank line "
        "between paragraphs.\n\n"
        "RULES: max 1-2 emojis, no BREAKING-style bait, cite the source in plain "
        "text, defensive guidance only.\n\n"
        'OUTPUT: respond ONLY with valid JSON, no fences: '
        '{"main_post":"...","hashtags":["..."]}'
    )
    return call_claude(client, system, "Intel brief JSON:\n" + json.dumps(brief))


def run_editor(client: anthropic.Anthropic, brief: dict[str, Any],
               draft: dict[str, Any]) -> dict[str, Any]:
    system = (
        "You are the managing editor and compliance reviewer for a cybersecurity "
        "consultancy's content.\n\n"
        "CHECK THE DRAFT LINKEDIN POST AGAINST THE INTEL BRIEF FOR:\n"
        "1. FACTUAL: CVE IDs, scores, vendors, dates match the brief. Flag anything "
        "not traceable to a source.\n"
        "2. SAFETY: no exploitation instructions or attacker-enabling detail.\n"
        "3. LEGAL: no defamatory attribution; unconfirmed breach claims labeled alleged.\n"
        "4. BRAND: no fear-mongering; mitigations concrete; 1100-1600 chars.\n\n"
        "If anything fails, FIX IT YOURSELF in the final post.\n\n"
        'OUTPUT: respond ONLY with valid JSON, no fences: '
        '{"verdict":"APPROVE|REVISED","final_post":"the publish-ready post text '
        'including hashtags","human_review_summary":"3 short bullets: what the post '
        'claims, and anything you are less than 95% sure about"}'
    )
    user = (
        "INTEL BRIEF:\n" + json.dumps(brief)
        + "\n\nDRAFT POST:\n" + draft["main_post"]
    )
    return call_claude(client, system, user)


# --------------------------------------------------------------------------
# Publishing
# --------------------------------------------------------------------------
def post_to_linkedin(text: str) -> str:
    """Publish a text post via the LinkedIn REST API.

    Needs LINKEDIN_ACCESS_TOKEN (scope w_member_social) and LINKEDIN_AUTHOR_URN
    (e.g. "urn:li:person:XXXX" or "urn:li:organization:XXXX").
    """
    import requests  # local import so the pipeline runs without it installed

    token = os.environ.get("LINKEDIN_ACCESS_TOKEN")
    author = os.environ.get("LINKEDIN_AUTHOR_URN")
    if not token or not author:
        raise RuntimeError(
            "Set LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN to publish."
        )

    resp = requests.post(
        "https://api.linkedin.com/rest/posts",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "LinkedIn-Version": "202405",
            "X-Restli-Protocol-Version": "2.0.0",
        },
        json={
            "author": author,
            "commentary": text,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.headers.get("x-restli-id", "posted")


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--brief", type=Path,
                        help="Reuse an existing brief JSON instead of researching.")
    parser.add_argument("--post", action="store_true",
                        help="Offer to publish to LinkedIn after the editor pass.")
    parser.add_argument("--yes", action="store_true",
                        help="Auto-approve publishing (for scheduled/headless runs).")
    args = parser.parse_args()

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY / ant profile
    today = dt.date.today().isoformat()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Research
    if args.brief:
        brief = json.loads(args.brief.read_text())
        print(f"Loaded brief from {args.brief}")
    else:
        print("Researching today's top cybersecurity development...")
        brief = run_research(client, today)
    print(f"  Headline: {brief.get('headline')}")

    # 2. Writer
    print("Drafting the LinkedIn post...")
    draft = run_writer(client, brief)

    # 3. Editor
    print("Fact-checking and finalizing...")
    review = run_editor(client, brief, draft)
    final_post = review["final_post"]

    # Persist everything for the audit trail / manual review.
    stem = OUTPUT_DIR / today
    (stem.with_suffix(".brief.json")).write_text(json.dumps(brief, indent=2))
    (stem.with_suffix(".post.txt")).write_text(final_post)
    (stem.with_suffix(".review.json")).write_text(json.dumps(review, indent=2))

    print("\n" + "=" * 60)
    print(f"Editor verdict: {review.get('verdict')}")
    print(f"Review notes:\n{review.get('human_review_summary')}")
    print("=" * 60)
    print(final_post)
    print("=" * 60)
    print(f"\nSaved to {stem}.post.txt")

    # 4. Human approval gate + publish
    if not args.post:
        print("\nRun again with --post to publish (nothing was sent to LinkedIn).")
        return 0

    if args.yes:
        approved = True
    else:
        approved = input("\nPublish this post to LinkedIn? [y/N] ").strip().lower() == "y"

    if not approved:
        print("Rejected — nothing published.")
        return 0

    post_id = post_to_linkedin(final_post)
    print(f"Published to LinkedIn: {post_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
