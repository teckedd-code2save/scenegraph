/**
 * Recorder pairing wire format (studio side).
 *
 * The studio encodes a one-click pairing payload and copies it to the
 * clipboard; the recorder extension's "Pair with workspace" button decodes
 * it (see apps/recorder-extension/src/pairing.ts). The format is pinned by
 * tests on both sides: `scenegraph-pair:` + a versioned JSON object.
 *
 *   scenegraph-pair:{"v":1,"apiUrl":"...","projectId":"...","accessToken":"..."}
 *
 * The access token is optional: local development records without one, and
 * the extension keeps its previously saved token when the payload omits it.
 */
export const PAIRING_PREFIX = "scenegraph-pair:";

export const encodePairing = ({apiUrl, projectId, accessToken}) => {
  const payload = {v: 1, apiUrl, projectId, ...(accessToken ? {accessToken} : {})};
  return `${PAIRING_PREFIX}${JSON.stringify(payload)}`;
};
