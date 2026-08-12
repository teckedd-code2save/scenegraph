import test from "node:test";
import assert from "node:assert/strict";
import {encodePairing, PAIRING_PREFIX} from "./pairing.js";

test("encodePairing emits the canonical scenegraph-pair wire format", () => {
  const text = encodePairing({apiUrl: "http://localhost:4100", projectId: "p_7f2a", accessToken: "tok_123"});
  assert.ok(text.startsWith(PAIRING_PREFIX));
  assert.deepEqual(JSON.parse(text.slice(PAIRING_PREFIX.length)), {
    v: 1,
    apiUrl: "http://localhost:4100",
    projectId: "p_7f2a",
    accessToken: "tok_123",
  });
});

test("encodePairing omits the access token when none is stored", () => {
  const text = encodePairing({apiUrl: "http://localhost:4100", projectId: "p_7f2a"});
  const payload = JSON.parse(text.slice(PAIRING_PREFIX.length));
  assert.equal("accessToken" in payload, false);
});

test("encodePairing keeps quotes and unicode in values intact", () => {
  const text = encodePairing({apiUrl: "https://sg.example.com", projectId: 'p_a"b', accessToken: "tok\u2028"});
  assert.deepEqual(JSON.parse(text.slice(PAIRING_PREFIX.length)), {
    v: 1,
    apiUrl: "https://sg.example.com",
    projectId: 'p_a"b',
    accessToken: "tok\u2028",
  });
});
