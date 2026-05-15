import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Canonical semver regex (X.Y.Z with optional -prerelease and +build).
// Rejects "1.0.0.0", "1.0.0.garbage", "1.0", etc. Addresses F-TESTS-010.
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/;

describe("version consistency", () => {
  // F-TESTS-009: read files inside each it() block so a missing file fails
  // only that test, not the whole suite.

  it("package.json version is canonical semver", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    assert.match(
      pkg.version,
      SEMVER_RE,
      `Expected canonical semver (X.Y.Z[-pre][+build]), got ${pkg.version}`,
    );
  });

  it("package.json version MAJOR matches CHANGELOG's latest [version] heading", () => {
    // F-TESTS-011: replace tautological ">= 1.0.0" with a real consistency
    // check — the package.json MAJOR must match the most recent ## [X.Y.Z]
    // heading in CHANGELOG.md.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf-8");
    const match = changelog.match(/^##\s*\[(\d+\.\d+\.\d+(?:-[\w.-]+)?)\]/m);
    assert.ok(
      match,
      "CHANGELOG.md does not contain a '## [X.Y.Z]' heading — required by Keep-a-Changelog format",
    );
    const changelogMajor = Number(match[1].split(".")[0]);
    const pkgMajor = Number(pkg.version.split(".")[0]);
    assert.equal(
      pkgMajor,
      changelogMajor,
      `package.json MAJOR (${pkgMajor}) does not match latest CHANGELOG heading MAJOR (${changelogMajor}, from [${match[1]}])`,
    );
  });

  it("CHANGELOG contains an explicit '## [<version>]' heading for current version", () => {
    // F-TESTS-007: tighten — must be an actual heading, not just a substring
    // (which would match a Markdown link reference at the bottom).
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf-8");
    const headingRe = new RegExp(`^##\\s*\\[${pkg.version.replace(/[.+]/g, "\\$&")}\\]`, "m");
    assert.match(
      changelog,
      headingRe,
      `CHANGELOG.md missing '## [${pkg.version}]' heading (must be an actual section heading, not just a link reference)`,
    );
  });

  it("LICENSE exists and is a canonical MIT License", () => {
    // F-TESTS-006: tighten — must START with "MIT License", not just contain
    // the substring "MIT" anywhere in the file.
    const license = readFileSync(join(ROOT, "LICENSE"), "utf-8");
    assert.ok(
      license.trimStart().startsWith("MIT License"),
      `LICENSE must begin with 'MIT License' (canonical first line); got: ${JSON.stringify(license.trimStart().slice(0, 40))}`,
    );
  });

  it("marketing/ is a directory containing schema/, data/, and manifests/", () => {
    // F-TESTS-008: tighten — was passing for an empty dir or even a file.
    // Now require it to be a real directory containing the three expected
    // subdirs.
    const marketingDir = join(ROOT, "marketing");
    assert.ok(existsSync(marketingDir), "marketing/ does not exist");
    assert.ok(statSync(marketingDir).isDirectory(), "marketing/ exists but is not a directory");
    const entries = new Set(readdirSync(marketingDir));
    for (const required of ["schema", "data", "manifests"]) {
      assert.ok(entries.has(required), `marketing/ missing required subdir: ${required}`);
      assert.ok(
        statSync(join(marketingDir, required)).isDirectory(),
        `marketing/${required} exists but is not a directory`,
      );
    }
  });
});
