#!/usr/bin/env node
// Node will not stay inside a project: module resolution walks up through every parent
// directory, so a stray node_modules anywhere above this repo can satisfy a dependency
// that is actually missing here. That combination is the worst failure mode — green
// locally, broken on a fresh checkout — so the boundary has to be asserted, not assumed.
//
// What this checks:
//   1. every declared dependency resolves *inside* this directory
//   2. no other package.json / node_modules sits between here and the git root
//      (a second project boundary would shadow this one)
//   3. which directories above the repo could be fallen back to (reported, not fatal —
//      they exist on developer machines and never on CI)
//
// Exit code 1 on 1 or 2, 0 otherwise. Run it from anywhere: paths are derived from this file.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(pkgDir, "package.json");
const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
const requireFromProject = createRequire(manifestPath);

const problems = [];
const escapes = [];

const isInsideProject = (file) => {
  const rel = relative(pkgDir, file);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/");
};

// 1. Runtime dependencies must live in this directory's node_modules.
for (const name of Object.keys(pkg.dependencies ?? {})) {
  let entry;
  try {
    entry = requireFromProject.resolve(name);
  } catch {
    problems.push(`${name} does not resolve — run \`npm ci\` in ${pkgDir}`);
    continue;
  }
  if (!isInsideProject(entry)) {
    problems.push(`${name} resolves outside the project: ${entry} — a fresh checkout will not have it`);
  }
}

// 2. Dev dependencies, same rule. Types-only packages have no entry point to resolve,
//    so fall back to checking the installed directory.
for (const name of Object.keys(pkg.devDependencies ?? {})) {
  let entry;
  try {
    entry = requireFromProject.resolve(name);
  } catch {
    const installed = join(pkgDir, "node_modules", name);
    if (!existsSync(installed)) {
      problems.push(`${name} is missing — run \`npm ci\` in ${pkgDir}`);
    }
    continue;
  }
  if (!isInsideProject(entry)) {
    problems.push(`${name} resolves outside the project: ${entry}`);
  }
}

// 3. Nothing between this directory and the repo root may look like another project.
let gitRoot = null;
for (let dir = pkgDir; ; ) {
  if (existsSync(join(dir, ".git"))) {
    gitRoot = dir;
    break;
  }
  const up = dirname(dir);
  if (up === dir) break;
  dir = up;
}

if (!gitRoot) {
  escapes.push(`no .git found above ${pkgDir} — repo boundary unknown, skipping check 2`);
} else {
  for (let dir = dirname(pkgDir); ; dir = dirname(dir)) {
    for (const marker of ["package.json", "node_modules"]) {
      if (existsSync(join(dir, marker))) {
        problems.push(`${join(dir, marker)} sits between this project and the repo root`);
      }
    }
    if (dir === gitRoot) break;
  }
}

// 4. Report, not fail: these directories exist on a developer machine and never on CI.
const boundary = gitRoot ?? pkgDir;
for (let dir = dirname(boundary); ; dir = dirname(dir)) {
  if (existsSync(join(dir, "node_modules"))) {
    escapes.push(`${join(dir, "node_modules")} is above the repo — Node falls back into it locally, CI has no such directory`);
  }
  const up = dirname(dir);
  if (up === dir) break;
}

for (const note of escapes) console.warn(`warn  ${note}`);
for (const problem of problems) console.error(`fail  ${problem}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} isolation problem(s) in ${pkgDir}`);
  process.exit(1);
}

const suffix = escapes.length > 0 ? ` (${escapes.length} escape route(s) above the repo)` : "";
console.log(`isolation ok — ${pkg.name} resolves entirely inside ${pkgDir}${suffix}`);
