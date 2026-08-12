/**
 * Recorder pairing wire format (extension side).
 *
 * Decodes the `scenegraph-pair:` payload copied to the clipboard by the
 * studio (see apps/studio/pairing.js). The format is pinned by tests on
 * both sides:
 *
 *   scenegraph-pair:{"v":1,"apiUrl":"...","projectId":"...","accessToken":"..."}
 *
 * The access token is optional; the popup keeps its previously saved token
 * when the payload omits it (local development records without one).
 */

export type PairingPayload = {
  v: 1;
  apiUrl: string;
  projectId: string;
  accessToken?: string;
};

export type PairingResult = {ok: true; pairing: PairingPayload} | {ok: false; error: string};

export const PAIRING_PREFIX = "scenegraph-pair:";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const parsePairing = (text: string): PairingResult => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PAIRING_PREFIX)) {
    return {ok: false, error: "No SceneGraph pairing found on the clipboard."};
  }
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed.slice(PAIRING_PREFIX.length));
  } catch {
    return {ok: false, error: "The clipboard pairing is not valid SceneGraph data."};
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return {ok: false, error: "The clipboard pairing is not valid SceneGraph data."};
  }
  const record = payload as Record<string, unknown>;
  if (record.v !== 1) {
    return {ok: false, error: "This pairing was created by a different SceneGraph version. Reload the extension."};
  }
  if (!isNonEmptyString(record.projectId)) {
    return {ok: false, error: "The clipboard pairing has no project ID."};
  }
  if (!isNonEmptyString(record.apiUrl)) {
    return {ok: false, error: "The clipboard pairing has no Studio API address."};
  }
  const accessToken =
    typeof record.accessToken === "string" && record.accessToken.length > 0
      ? record.accessToken
      : undefined;
  return {
    ok: true,
    pairing: {v: 1, apiUrl: record.apiUrl, projectId: record.projectId, ...(accessToken ? {accessToken} : {})},
  };
};
