let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];

const start = async (streamId: string) => {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // Chromium's tabCapture constraint is not represented by lib.dom types.
      mandatory: {chromeMediaSource: "tab", chromeMediaSourceId: streamId},
    } as MediaTrackConstraints,
  });
  chunks = [];
  recorder = new MediaRecorder(stream, {mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 12_000_000});
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.start(1000);
};

const stopAndUpload = async (message: Record<string, unknown>) => {
  if (!recorder || !stream) throw new Error("Recorder is not active");
  const blob = await new Promise<Blob>((resolve) => {
    recorder!.onstop = () => resolve(new Blob(chunks, {type: "video/webm"}));
    recorder!.stop();
  });
  stream.getTracks().forEach((track) => track.stop());
  const apiUrl = String(message.apiUrl);
  const projectId = String(message.projectId);
  const captureId = String(message.captureId);
  const uploaded = await fetch(`${apiUrl}/v1/projects/${projectId}/captures/${captureId}/video`, {
    method: "PUT",
    headers: {"content-type": "video/webm"},
    body: blob,
  });
  if (!uploaded.ok) throw new Error(`Video upload failed (${uploaded.status})`);
  const {videoUrl} = await uploaded.json() as {videoUrl: string};
  const manifest = {
    id: captureId,
    projectId,
    sourceUrl: message.sourceUrl,
    startedAt: message.startedAt,
    durationMs: message.durationMs,
    viewport: message.viewport,
    videoUrl,
    events: message.events,
  };
  const finalized = await fetch(`${apiUrl}/v1/projects/${projectId}/captures`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(manifest),
  });
  if (!finalized.ok) throw new Error(`Capture finalization failed (${finalized.status})`);
  return {ok: true, captureId};
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return;
  if (message.type === "START_RECORDING") {
    start(message.streamId).then(() => sendResponse({ok: true})).catch((error) => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message.type === "STOP_RECORDING") {
    stopAndUpload(message).then(sendResponse).catch((error) => sendResponse({ok: false, error: error.message}));
    return true;
  }
});
