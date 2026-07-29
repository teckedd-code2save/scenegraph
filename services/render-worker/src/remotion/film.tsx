import React from "react";
import {
  AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, spring,
  useCurrentFrame, useVideoConfig,
} from "remotion";
import type {CaptureEvent, RenderJob, ScenePlan} from "@scenegraph/contracts";

type Scene = ScenePlan["scenes"][number];
const font = "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif";

const Editorial: React.FC<{scene: Scene; job: RenderJob}> = ({scene, job}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 24, stiffness: 110, mass: 0.8}});
  return (
    <AbsoluteFill style={{
      background: job.plan.brand.surface,
      color: job.plan.brand.ink,
      fontFamily: font,
      padding: "112px 136px",
      justifyContent: "space-between",
    }}>
      <div style={{display: "flex", gap: 16, alignItems: "center", fontSize: 24, fontWeight: 650}}>
        <span style={{width: 14, height: 14, borderRadius: 20, background: job.plan.brand.primary}} />
        {job.plan.title.replace(/ launch$/i, "")}
      </div>
      <div style={{maxWidth: 1320, opacity: enter, transform: `translateY(${42 * (1 - enter)}px)`}}>
        <div style={{fontSize: 94, lineHeight: 1.02, letterSpacing: "-0.055em", fontWeight: 650}}>
          {scene.headline}
        </div>
        {scene.support ? <div style={{fontSize: 30, lineHeight: 1.4, marginTop: 38, opacity: 0.62}}>{scene.support}</div> : null}
      </div>
      <div style={{fontSize: 17, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.45}}>
        {scene.role} · SceneGraph directed cut
      </div>
    </AbsoluteFill>
  );
};

const Cursor: React.FC<{event: CaptureEvent; viewport: RenderJob["capture"]["viewport"]}> = ({event, viewport}) => {
  const frame = useCurrentFrame();
  if (!event.rect) return null;
  const x = (event.rect.x + event.rect.width / 2) / viewport.width * 1920;
  const y = (event.rect.y + event.rect.height / 2) / viewport.height * 1080;
  const ring = event.kind === "click"
    ? interpolate(frame, [12, 20], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})
    : 0;
  return (
    <>
      {event.kind === "click" ? <div style={{
        position: "absolute", left: x - 18 - ring * 15, top: y - 18 - ring * 15,
        width: 36 + ring * 30, height: 36 + ring * 30, borderRadius: 999,
        border: `2px solid rgba(255,255,255,${0.42 * (1 - ring)})`, opacity: 1 - ring,
      }} /> : null}
      <svg viewBox="0 0 32 40" width="32" height="40" style={{
        position: "absolute", left: x, top: y, transform: "translate(-4px,-3px)",
        filter: "drop-shadow(0 2px 5px rgba(0,0,0,.4))",
      }}>
        <path d="M3 2v29l8-7 6 13 5-3-6-12h11z" fill="white" stroke="#101210" strokeWidth="1.5"/>
      </svg>
    </>
  );
};

const Product: React.FC<{scene: Scene; job: RenderJob}> = ({scene, job}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const duration = Math.round(scene.durationMs / 1000 * fps);
  const progress = interpolate(frame, [0, duration], [0, 1], {
    easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const scale = interpolate(progress, [0, 1], [scene.camera.from.scale, scene.camera.to.scale]);
  const x = interpolate(progress, [0, 1], [scene.camera.from.x, scene.camera.to.x]);
  const y = interpolate(progress, [0, 1], [scene.camera.from.y, scene.camera.to.y]);
  const event = job.capture.events.find((candidate) => scene.focusEventIds.includes(candidate.id));
  return (
    <AbsoluteFill style={{background: "#0B0D0B", overflow: "hidden"}}>
      <AbsoluteFill style={{transform: `translate(${x * scale}px,${y * scale}px) scale(${scale})`, transformOrigin: "center"}}>
        <OffthreadVideo
          src={job.capture.videoUrl}
          startFrom={Math.round((scene.source?.fromMs ?? 0) / 1000 * fps)}
          style={{width: "100%", height: "100%", objectFit: "cover"}}
        />
      </AbsoluteFill>
      {event ? <Cursor event={event} viewport={job.capture.viewport} /> : null}
      <div style={{
        position: "absolute", left: 52, top: 48, padding: "12px 18px",
        background: "rgba(12,14,12,.82)", color: "white", font: `600 20px ${font}`, borderRadius: 8,
      }}>{scene.headline}</div>
    </AbsoluteFill>
  );
};

export const LaunchFilm: React.FC<{job: RenderJob}> = ({job}) => {
  const {fps} = useVideoConfig();
  return <AbsoluteFill>{job.plan.scenes.map((scene) => {
    const editorial = ["hook", "problem", "fit", "close"].includes(scene.role);
    return (
      <Sequence
        key={scene.id}
        from={Math.round(scene.startMs / 1000 * fps)}
        durationInFrames={Math.round(scene.durationMs / 1000 * fps)}
      >
        {editorial ? <Editorial scene={scene} job={job} /> : <Product scene={scene} job={job} />}
      </Sequence>
    );
  })}</AbsoluteFill>;
};
