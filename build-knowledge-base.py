#!/usr/bin/env python3
"""
build-knowledge-base.py
=======================
Wineshipping Benefits Hub — Automatic Knowledge Base Builder

Run this script whenever new PDF materials are added to the assets/ folder.
It will:
  1. Extract text from every PDF in assets/
  2. Rebuild netlify/functions/knowledge-base.md with structured content
  3. Commit and push to GitHub (triggering a Netlify auto-deploy)

Usage:
  python3 build-knowledge-base.py              # rebuild + commit + push
  python3 build-knowledge-base.py --dry-run    # rebuild only, no git operations
  python3 build-knowledge-base.py --no-push    # rebuild + commit, skip push

Requirements:
  pip install pdfplumber
"""

import os
import sys
import json
import subprocess
import datetime
import argparse

try:
    import pdfplumber
except ImportError:
    print("Installing pdfplumber...")
    subprocess.run([sys.executable, "-m", "pip", "install", "pdfplumber", "--break-system-packages", "-q"])
    import pdfplumber

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(REPO_ROOT, "assets")
KB_OUTPUT = os.path.join(REPO_ROOT, "netlify", "functions", "knowledge-base.md")
MANIFEST_FILE = os.path.join(REPO_ROOT, ".kb-manifest.json")

# PDFs to skip from the knowledge base (drug formularies are too large;
# Spanish duplicates are noted in the KB header instead)
SKIP_FILES = {
    "Essential_Drug_List_Four_Tier_ABC.pdf",
    "Essential_Drug_List_Four_Tier_ABC_Sp.pdf",
}

# Files we treat as Spanish duplicates (noted but not re-processed)
SPANISH_SUFFIX_PATTERNS = ["-ES.pdf", "-ES.PDF"]

def is_spanish(filename):
    return any(filename.endswith(p) for p in SPANISH_SUFFIX_PATTERNS)

def extract_pdf(path):
    """Extract text from a PDF file."""
    try:
        with pdfplumber.open(path) as pdf:
            return "\n".join(page.extract_text() or "" for page in pdf.pages).strip()
    except Exception as e:
        return f"[ERROR extracting {os.path.basename(path)}: {e}]"

def get_pdf_manifest():
    """Return dict of {filename: mtime} for all PDFs in assets/."""
    manifest = {}
    for fname in os.listdir(ASSETS_DIR):
        if fname.lower().endswith(".pdf"):
            fpath = os.path.join(ASSETS_DIR, fname)
            manifest[fname] = os.path.getmtime(fpath)
    return manifest

def load_previous_manifest():
    if os.path.exists(MANIFEST_FILE):
        with open(MANIFEST_FILE) as f:
            return json.load(f)
    return {}

def save_manifest(manifest):
    with open(MANIFEST_FILE, "w") as f:
        json.dump(manifest, f, indent=2)

def detect_changes(old_manifest, new_manifest):
    added = [f for f in new_manifest if f not in old_manifest]
    removed = [f for f in old_manifest if f not in new_manifest]
    modified = [f for f in new_manifest if f in old_manifest and new_manifest[f] != old_manifest[f]]
    return added, removed, modified

def build_knowledge_base(dry_run=False):
    """Extract all PDFs and write knowledge-base.md."""
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Building knowledge base from {ASSETS_DIR}...\n")

    old_manifest = load_previous_manifest()
    new_manifest = get_pdf_manifest()
    added, removed, modified = detect_changes(old_manifest, new_manifest)

    if old_manifest and not (added or removed or modified):
        print("No changes detected in assets/. Knowledge base is up to date.")
        return False

    if added:
        print(f"  New files:      {', '.join(added)}")
    if modified:
        print(f"  Modified files: {', '.join(modified)}")
    if removed:
        print(f"  Removed files:  {', '.join(removed)}")
    print()

    # Extract all EN PDFs (skip large/duplicate files)
    extracted = {}
    errors = []
    all_files = sorted(new_manifest.keys())
    en_files = [f for f in all_files if f not in SKIP_FILES and not is_spanish(f)]
    es_files = [f for f in all_files if f not in SKIP_FILES and is_spanish(f)]

    for fname in en_files:
        fpath = os.path.join(ASSETS_DIR, fname)
        text = extract_pdf(fpath)
        if text.startswith("[ERROR"):
            errors.append(fname)
            print(f"  ERR {fname}")
        else:
            extracted[fname] = text
            print(f"  OK  {fname} ({len(text):,} chars)")

    if errors:
        print(f"\n  WARNING: {len(errors)} file(s) failed to extract: {errors}")

    # Build the knowledge base markdown
    now = datetime.datetime.now().strftime("%B %d, %Y at %I:%M %p")
    lines = [
        f"# Wineshipping.com Benefits Knowledge Base",
        f"",
        f"**Last updated:** {now}",
        f"**Source documents:** {len(en_files)} English PDFs extracted from assets/",
        f"**Spanish versions available** for most documents (see assets/ folder).",
        f"",
        f"---",
        f"",
    ]

    # Organize by category
    categories = {
        "ENROLLMENT & HR": ["Carrier-Contacts", "Employee-Contributions"],
        "MEDICAL": ["EPO-Summary", "HDHP-Summary", "PPO-Summary", "HMO-Summary", "EPO-SBC", "HDHP-SBC", "PPO-SBC", "HMO-SBC"],
        "DENTAL": ["Summary-of-Dental"],
        "VISION": ["Vision-Summary", "SOB Vision"],
        "SPENDING ACCOUNTS": ["HSA-Overview", "Health-Care-FSA", "FSA-Plan-Highlights", "FSA-and-Commuter", "Limited-Purpose-FSA", "Dependent-Care-FSA", "Spending-Account", "Commuter-and-Parking"],
        "LIFE & DISABILITY": ["Basic-Life", "Life-and-ADD", "Short-Term-Disability"],
        "VOLUNTARY BENEFITS": ["Accident-Coverage", "Critical-Illness", "Hospital-Indemnity"],
        "EAP": ["EAP-Employee-FAQ", "ComPsych"],
        "LEGAL & COMPLIANCE": ["COBRA", "General-Plan-Notices", "Medicare-Part-D", "HRA-Plan-Document"],
        "OTHER": ["Setup-Direct-Deposit"],
    }

    used_files = set()
    for category, prefixes in categories.items():
        cat_files = []
        for fname in sorted(extracted.keys()):
            if any(fname.startswith(p) or p in fname for p in prefixes):
                cat_files.append(fname)
                used_files.add(fname)

        if not cat_files:
            continue

        lines.append(f"## {category}")
        lines.append("")
        for fname in cat_files:
            lines.append(f"### {fname.replace('.pdf', '').replace('-', ' ').replace('_', ' ')}")
            lines.append(f"*Source: assets/{fname}*")
            lines.append("")
            lines.append(extracted[fname][:8000])  # cap very long docs
            if len(extracted[fname]) > 8000:
                lines.append(f"\n*[Content truncated — full document at assets/{fname}]*")
            lines.append("")
            lines.append("---")
            lines.append("")

    # Catch any uncategorized files
    uncategorized = [f for f in extracted if f not in used_files]
    if uncategorized:
        lines.append("## OTHER DOCUMENTS")
        lines.append("")
        for fname in sorted(uncategorized):
            lines.append(f"### {fname.replace('.pdf', '')}")
            lines.append(f"*Source: assets/{fname}*")
            lines.append("")
            lines.append(extracted[fname][:5000])
            lines.append("")
            lines.append("---")
            lines.append("")

    # Spanish note
    if es_files:
        lines.append("## SPANISH LANGUAGE DOCUMENTS")
        lines.append("")
        lines.append("The following Spanish-language documents are available in the assets/ folder:")
        for fname in sorted(es_files):
            lines.append(f"- `assets/{fname}`")
        lines.append("")

    kb_content = "\n".join(lines)

    if not dry_run:
        with open(KB_OUTPUT, "w", encoding="utf-8") as f:
            f.write(kb_content)
        save_manifest(new_manifest)
        print(f"\nKnowledge base written to {KB_OUTPUT}")
        print(f"  {len(kb_content):,} characters | {len(lines)} lines")
    else:
        print(f"\n[DRY RUN] Would write {len(kb_content):,} chars to {KB_OUTPUT}")

    return True

def git_commit_and_push(no_push=False):
    """Commit the updated knowledge base and push to GitHub."""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    print("\nCommitting changes...")
    subprocess.run(["git", "add",
                    "netlify/functions/knowledge-base.md",
                    ".kb-manifest.json"],
                   cwd=REPO_ROOT, check=True)

    result = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO_ROOT)
    if result.returncode == 0:
        print("Nothing to commit — knowledge base unchanged.")
        return

    subprocess.run(["git", "commit", "-m",
                    f"Auto-update knowledge base from PDFs ({now})"],
                   cwd=REPO_ROOT, check=True)
    print("Committed.")

    if not no_push:
        print("Pushing to GitHub (Netlify will auto-deploy)...")
        subprocess.run(["git", "push", "origin", "main"], cwd=REPO_ROOT, check=True)
        print("Pushed. Netlify deploy will start shortly.")
    else:
        print("Skipped push (--no-push flag set). Run 'git push origin main' manually.")

def main():
    parser = argparse.ArgumentParser(description="Rebuild Aimee's knowledge base from PDF assets.")
    parser.add_argument("--dry-run", action="store_true", help="Extract and preview only; don't write files or commit")
    parser.add_argument("--no-push", action="store_true", help="Commit but don't push to GitHub")
    parser.add_argument("--force", action="store_true", help="Rebuild even if no changes detected")
    args = parser.parse_args()

    if args.force and os.path.exists(MANIFEST_FILE):
        os.remove(MANIFEST_FILE)

    changed = build_knowledge_base(dry_run=args.dry_run)

    if not args.dry_run and changed:
        git_commit_and_push(no_push=args.no_push)
    elif not changed:
        print("Nothing to do.")

if __name__ == "__main__":
    main()
