#!/usr/bin/env python3
import os, subprocess, pathlib, sys, textwrap, shlex
from datetime import datetime

BASE_BRANCH = os.getenv("BASE_BRANCH", "master")
CHANGE_BRANCH = os.getenv("CHANGE_BRANCH", f"codex/refactor-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-codex")
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]

def run(cmd, check=True):
    print(f"$ {cmd}")
    p = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if check and p.returncode != 0:
        print(p.stdout)
        print(p.stderr, file=sys.stderr)
        sys.exit(p.returncode)
    return p.stdout.strip()

def git(args, check=True):
    return run(f"git {args}", check=check)

def should_include_file(path):
    incl_ext = {".js",".ts",".tsx",".py",".rb",".go",".java",".cs",".cpp",".c",".h",".hpp",".rs",".swift",".php",".sh",".yml",".yaml",".json",".md",".html",".css"}
    p = pathlib.Path(path)
    if p.suffix.lower() in incl_ext and "node_modules/" not in path and ".git/" not in path and "vendor/" not in path:
        return True
    return False

def list_files():
    out = git("ls-files")
    return [f for f in out.splitlines() if should_include_file(f)]

def repo_map(files, max_per_file_chars=4000, max_files=150):
    parts = []
    for fp in files[:max_files]:
        try:
            text = pathlib.Path(fp).read_text(encoding="utf-8", errors="ignore")
            parts.append(f"--- {fp} ---\n{text[:max_per_file_chars]}")
        except Exception:
            pass
    return "\n\n".join(parts)

def build_prompts(summary):
    user_goal = """
Review the entire codebase with the goal of raising overall quality and maintainability.
Identify duplicate, near-duplicate, or overly verbose code that can be consolidated, and refactor it to improve clarity and consistency.
Break down monolithic functions into smaller, more focused units and ensure the code is DRY, clean, and easy to understand.
Avoid unnecessary abstraction—do not introduce classes or functions that add complexity without real benefit—but re-implement outdated or incompatible code in a modern, clean way aligned with the current architecture.
The objective is to deliver a streamlined, high-quality, and consistent codebase that is maintainable, readable, and free of redundant logic.
"""
    system = """
You are an expert software engineer. Output ONLY a single unified diff (GNU patch format) relative to the current repository state.
Rules:
- No prose; only diff.
- Correct repo-relative paths.
- Include new/removed/renamed files as needed.
- Keep changes small but meaningful; safe refactors preferred.
- The diff must apply cleanly with: git apply --index --whitespace=fix
"""
    user = textwrap.dedent(user_goal).strip() + "\n\nREPO MAP (truncated):\n" + summary
    return system.strip(), user

def call_openai(system_prompt, user_prompt):
    from openai import OpenAI                         # Responses API
    client = OpenAI(api_key=OPENAI_API_KEY)           # Auth with API key
    resp = client.responses.create(
        model=OPENAI_MODEL,
        input=[{"role":"system","content":system_prompt},
               {"role":"user","content":user_prompt}],
        temperature=0.2,
        max_output_tokens=100000
    )
    # SDK returns .output_text for the combined text
    return getattr(resp, "output_text", str(resp)).strip()

def main():
    git(f"checkout {shlex.quote(BASE_BRANCH)}")
    git("pull --ff-only")

    files = list_files()
    summary = repo_map(files)

    system_p, user_p = build_prompts(summary)
    diff = call_openai(system_p, user_p)

    if not diff.startswith(("diff --git", "--- ")):
        print("Model did not return a unified diff; exiting without changes.")
        print(diff[:2000])
        return

    git(f"checkout -b {shlex.quote(CHANGE_BRANCH)}")
    patch_file = ".codex.patch"
    pathlib.Path(patch_file).write_text(diff, encoding="utf-8")
    run(f"git apply --index --whitespace=fix {patch_file}")

    if not git("status --porcelain", check=False):
        print("No changes to commit.")
        return

    git('commit -m "Nightly automated refactor (Codex)"')
    git(f"push -u origin {shlex.quote(CHANGE_BRANCH)}")
    print("Branch pushed; PR step will create/update the pull request.")

if __name__ == "__main__":
    main()
