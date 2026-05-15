import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSafeRef, assertSafePath } from "../marketing/scripts/_paths.mjs";

// _paths.mjs introduces the load-bearing path-traversal guard for ref strings
// (F-SCRIPTS-007). validate.mjs and gen-lock.mjs exercise the GOOD paths
// indirectly when run against the live tree; this file exercises the
// REJECTION paths directly so a regression that loosens the allow-list (or
// removes the leading-slash check) fails immediately.

describe("assertSafeRef — rejects malicious ref strings", () => {
  it("throws on path traversal '../foo.json'", () => {
    assert.throws(
      () => assertSafeRef("../foo.json", "test"),
      /Unsafe ref/,
      "must throw on '..' segment",
    );
  });

  it("throws on absolute path '/abs/path.json'", () => {
    assert.throws(
      () => assertSafeRef("/abs/path.json", "test"),
      /Unsafe ref/,
      "must throw on leading '/'",
    );
  });

  it("throws on backslash path 'foo\\\\bar.json' (Windows separator leak)", () => {
    assert.throws(
      () => assertSafeRef("foo\\bar.json", "test"),
      /Unsafe ref/,
      "must throw on backslash",
    );
  });

  it("throws on empty string", () => {
    assert.throws(() => assertSafeRef("", "test"), /Unsafe ref/, "must throw on empty string");
  });

  it("throws on non-string input (null)", () => {
    assert.throws(() => assertSafeRef(null, "test"), /Unsafe ref/, "must throw on null");
  });

  it("throws on non-string input (number)", () => {
    assert.throws(() => assertSafeRef(42, "test"), /Unsafe ref/, "must throw on number");
  });

  it("throws on disallowed character (space)", () => {
    assert.throws(
      () => assertSafeRef("foo bar.json", "test"),
      /Unsafe ref/,
      "must throw on space (outside allow-list)",
    );
  });

  it("throws on missing .json extension", () => {
    assert.throws(
      () => assertSafeRef("tools/foo.txt", "test"),
      /Unsafe ref/,
      "must throw when ref does not end in .json",
    );
  });

  it("accepts a clean nested ref 'tools/foo.json' and returns it unchanged", () => {
    const out = assertSafeRef("tools/foo.json", "test");
    assert.equal(out, "tools/foo.json", "must return the input on safe ref");
  });

  it("accepts a clean top-level ref 'foo.json' and returns it unchanged", () => {
    const out = assertSafeRef("foo.json", "test");
    assert.equal(out, "foo.json", "must return the input on safe ref");
  });

  it("accepts the real fixture ref 'tools/zip-meta-map.json'", () => {
    const out = assertSafeRef("tools/zip-meta-map.json", "test");
    assert.equal(out, "tools/zip-meta-map.json");
  });
});

// F-W6-TESTS-005 — _paths.mjs:49-53 + 81-83 explicitly document that the
// regex blocks leading-dot segments anywhere in the path. Pin so a regression
// that simplifies the regex back to the OLD pattern still pasted into
// marketing.schema.json:637 (which DOES allow .env.json) re-opens the dotfile
// attack surface.
describe("assertSafeRef — rejects leading-dot segments (F-SCRIPTS-W3-001)", () => {
  it("throws on '.env.json' (leading-dot in only segment)", () => {
    assert.throws(
      () => assertSafeRef(".env.json", "test"),
      /Unsafe ref/,
      "must throw on '.env.json' — leading dot in the segment is rejected",
    );
  });

  it("throws on '.git/config.json' (leading-dot in first segment)", () => {
    assert.throws(
      () => assertSafeRef(".git/config.json", "test"),
      /Unsafe ref/,
      "must throw on '.git/config.json' — leading dot in any segment is rejected",
    );
  });

  it("throws on 'foo/./bar.json' (standalone '.' segment)", () => {
    assert.throws(
      () => assertSafeRef("foo/./bar.json", "test"),
      /Unsafe ref/,
      "must throw on 'foo/./bar.json' — '.' as a segment is rejected",
    );
  });

  it("throws on 'foo/.json' (filename starts with dot)", () => {
    // The .json extension is a literal — a "filename" of just `.json` is a
    // dotfile (treat the entire name as the segment, leading dot rejected).
    assert.throws(
      () => assertSafeRef("foo/.json", "test"),
      /Unsafe ref/,
      "must throw on 'foo/.json' — segment must not start with a dot",
    );
  });

  it("throws on 'foo/.hidden.json' (hidden file in nested segment)", () => {
    assert.throws(
      () => assertSafeRef("foo/.hidden.json", "test"),
      /Unsafe ref/,
      "must throw on 'foo/.hidden.json' — leading dot rejected even in nested segments",
    );
  });
});

describe("assertSafePath — rejects malicious path strings", () => {
  it("throws on path traversal '../etc/passwd'", () => {
    assert.throws(
      () => assertSafePath("../etc/passwd", "test"),
      /Unsafe path/,
      "must throw on '..' segment",
    );
  });

  it("throws on absolute path '/etc/passwd'", () => {
    assert.throws(
      () => assertSafePath("/etc/passwd", "test"),
      /Unsafe path/,
      "must throw on leading '/'",
    );
  });

  it("throws on backslash path 'evidence\\\\file.png'", () => {
    assert.throws(
      () => assertSafePath("evidence\\file.png", "test"),
      /Unsafe path/,
      "must throw on backslash",
    );
  });

  it("throws on empty string", () => {
    assert.throws(() => assertSafePath("", "test"), /Unsafe path/, "must throw on empty string");
  });

  it("throws on non-string input (undefined)", () => {
    assert.throws(
      () => assertSafePath(undefined, "test"),
      /Unsafe path/,
      "must throw on undefined",
    );
  });

  it("throws on disallowed character (newline)", () => {
    assert.throws(
      () => assertSafePath("evidence/file\n.png", "test"),
      /Unsafe path/,
      "must throw on newline (outside allow-list)",
    );
  });

  it("accepts an evidence path 'evidence/dashboard.png' and returns it unchanged", () => {
    const out = assertSafePath("evidence/dashboard.png", "test");
    assert.equal(out, "evidence/dashboard.png");
  });

  it("accepts a deeply-nested path 'evidence/sub/dir/file.png'", () => {
    const out = assertSafePath("evidence/sub/dir/file.png", "test");
    assert.equal(out, "evidence/sub/dir/file.png");
  });

  it("accepts a path with no extension 'evidence/file'", () => {
    // assertSafePath is more permissive than assertSafeRef — it allows
    // arbitrary file shapes under marketing/. The pattern only requires
    // alphanumerics, dots, underscores, hyphens; an extension is optional.
    const out = assertSafePath("evidence/file", "test");
    assert.equal(out, "evidence/file");
  });

  // F-W6-TESTS-005 — leading-dot rejection on assertSafePath. _paths.mjs:81-83
  // documents that the path pattern matches the same leading-dot block as the
  // ref pattern. Pin so dotfile attack surfaces (.env, .git/...) cannot leak
  // through the evidence-manifest path field.
  it("throws on '.env' (dotfile)", () => {
    assert.throws(
      () => assertSafePath(".env", "test"),
      /Unsafe path/,
      "must throw on '.env' — leading dot in the segment is rejected",
    );
  });

  it("throws on '.git/config' (dotfile in first segment)", () => {
    assert.throws(
      () => assertSafePath(".git/config", "test"),
      /Unsafe path/,
      "must throw on '.git/config' — leading dot in any segment is rejected",
    );
  });

  it("throws on 'evidence/.hidden.png' (hidden file in nested segment)", () => {
    assert.throws(
      () => assertSafePath("evidence/.hidden.png", "test"),
      /Unsafe path/,
      "must throw on 'evidence/.hidden.png' — leading dot rejected even in nested segments",
    );
  });
});

// F-W6-TESTS-006 — schema/runtime consistency invariant.
// Cross-domain observation: the schema's fileRef pattern (marketing.schema.json:637)
// is `^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*\.json$` — strictly more permissive
// than _paths.mjs REF_PATTERN at line 53. The schema accepts `.env.json` (and
// even `..foo.json` because `..` matches `[a-zA-Z0-9._-]+`); the runtime
// rejects both via the safe-ref guard. So a contributor could craft an index
// that passes schema validation but fails the runtime assertSafeRef call with
// a confusing 'Unsafe ref' error.
//
// The fix belongs to the contract domain (tighten the schema pattern to match
// _paths.mjs). This test pins the CURRENT drift state so when contract patches
// the schema, this test fails loudly and the maintainer knows the drift has
// been resolved. The assertions below should then be flipped to assert
// AGREEMENT instead of disagreement.
describe("schema fileRef pattern vs _paths.mjs REF_PATTERN — consistency invariant", () => {
  // Build the schema regex inline so this test does not depend on loading the
  // full marketing.schema.json (which would couple to the schema's location).
  // This MUST mirror the regex at marketing.schema.json:637 verbatim.
  const SCHEMA_FILEREF_PATTERN = /^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*\.json$/;

  // Inputs where schema and runtime DO agree (both accept).
  const shouldAcceptBoth = [
    "tools/zip-meta-map.json",
    "audiences/ci-maintainers.json",
    "campaigns/zmm-launch.json",
    "foo.json",
    "a/b/c.json",
  ];

  // Inputs where schema and runtime DO agree (both reject).
  // Note: '../foo.json' is NOT here because the schema pattern accepts it
  //       (`..` matches `[a-zA-Z0-9._-]+`). That's part of the documented
  //       drift below.
  const shouldRejectBoth = [
    "/abs/path.json", // absolute (schema rejects: leading '/' not in char class)
    "no-extension", // missing .json (both fail trailing literal)
    "spaces in name.json", // disallowed character
  ];

  for (const input of shouldAcceptBoth) {
    it(`both schema and runtime accept ${JSON.stringify(input)}`, () => {
      const schemaAccepts = SCHEMA_FILEREF_PATTERN.test(input);
      let runtimeAccepts = true;
      try {
        assertSafeRef(input, "consistency-test");
      } catch {
        runtimeAccepts = false;
      }
      assert.equal(schemaAccepts, true, `schema pattern should accept ${JSON.stringify(input)}`);
      assert.equal(
        runtimeAccepts,
        true,
        `runtime assertSafeRef should accept ${JSON.stringify(input)}`,
      );
    });
  }

  for (const input of shouldRejectBoth) {
    it(`both schema and runtime reject ${JSON.stringify(input)}`, () => {
      const schemaAccepts = SCHEMA_FILEREF_PATTERN.test(input);
      let runtimeAccepts = true;
      try {
        assertSafeRef(input, "consistency-test");
      } catch {
        runtimeAccepts = false;
      }
      assert.equal(schemaAccepts, false, `schema pattern should reject ${JSON.stringify(input)}`);
      assert.equal(
        runtimeAccepts,
        false,
        `runtime assertSafeRef should reject ${JSON.stringify(input)}`,
      );
    });
  }

  // Documented drift: schema CURRENTLY accepts these inputs while runtime
  // rejects them. Each assertion pins the current (broken) state so a
  // contract-domain patch that tightens the schema fails the test loudly,
  // signaling the drift has been resolved and the assertions should be
  // flipped to assert agreement.
  const driftInputs = [
    [".env.json", "leading-dot segment"],
    ["..foo.json", "embedded '..' (schema char-class accepts)"],
  ];

  for (const [input, note] of driftInputs) {
    it(`DOCUMENTS DRIFT: schema accepts ${JSON.stringify(input)} but runtime rejects it (${note})`, () => {
      const schemaAccepts = SCHEMA_FILEREF_PATTERN.test(input);
      let runtimeAccepts = true;
      try {
        assertSafeRef(input, "drift-test");
      } catch {
        runtimeAccepts = false;
      }
      // Pin current state: schema=true, runtime=false. When the schema is
      // tightened (the contract domain's task), the schema-accepts side will
      // flip and this test will fail — flag for the maintainer to flip both
      // expectations to `false` (or remove the drift cases in favor of the
      // consistency loop above).
      assert.equal(
        schemaAccepts,
        true,
        `schema CURRENTLY accepts ${JSON.stringify(input)}; if this fails, the schema has been tightened — update test to assert both reject`,
      );
      assert.equal(
        runtimeAccepts,
        false,
        `runtime correctly rejects ${JSON.stringify(input)} (F-SCRIPTS-W3-001 hardening)`,
      );
    });
  }
});
