// Canonical wire-format tests for the recorder's pairing decoder.
// Requires a build first (the test script compiles src/ → dist/ before
// running node --test): import "./dist/pairing.js".
import test from "node:test";
import assert from "node:assert/strict";
import {parsePairing, PAIRING_PREFIX} from "./dist/pairing.js";

const studioWire = (payload) => `${PAIRING_PREFIX}${JSON.stringify(payload)}`;

test("parsePairing accepts the studio wire format with a token", () => {
  const result = parsePairing(studioWire({v: 1, apiUrl: "http://localhost:4100", projectId: "p_7f2a", accessToken: "tok_123"}));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.pairing, {v: 1, apiUrl: "http://localhost:4100", projectId: "p_7f2a", accessToken: "tok_123"});
  }
});

test("parsePairing accepts a pairing without a token", () => {
  const result = parsePairing(studioWire({v: 1, apiUrl: "http://localhost:4100", projectId: "p_7f2a"}));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.pairing, {v: 1, apiUrl: "http://localhost:4100", projectId: "p_7f2a"});
  }
});

test("parsePairing tolerates surrounding whitespace", () => {
  const result = parsePairing(`  ${studioWire({v: 1, apiUrl: "http://localhost:4100", projectId: "p_7f2a"})}\n`);
  assert.equal(result.ok, true);
});

test("parsePairing rejects foreign clipboard content", () => {
  const result = parsePairing("hello from another application");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /No SceneGraph pairing/);
});

test("parsePairing rejects malformed JSON after the prefix", () => {
  const result = parsePairing(`${PAIRING_PREFIX}{not json`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not valid SceneGraph data/);
});

test("parsePairing rejects unknown versions", () => {
  const result = parsePairing(studioWire({v: 2, apiUrl: "http://localhost:4100", projectId: "p_7f2a"}));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /different SceneGraph version/);
});

test("parsePairing rejects payloads without a project ID", () => {
  const result = parsePairing(studioWire({v: 1, apiUrl: "http://localhost:4100"}));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no project ID/);
});

test("parsePairing rejects payloads without an API URL", () => {
  const result = parsePairing(studioWire({v: 1, projectId: "p_7f2a"}));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no Studio API address/);
});
