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
});
