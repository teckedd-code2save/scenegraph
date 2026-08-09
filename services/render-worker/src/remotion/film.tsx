import React from "react";
import {
  AbsoluteFill, Easing, interpolate, Sequence, spring, Video,
  useCurrentFrame, useVideoConfig,
} from "remotion";
import type {CaptureEvent, RenderJob, ScenePlan} from "@scenegraph/contracts";

type Scene = ScenePlan["scenes"][number];
const font = "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif";

const Editorial: React.FC<{scene: Scene; job: RenderJob}> = ({scene, job}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const words = scene.headline.split(/\s+/);
  const duration = Math.round(scene.durationMs / 1000 * fps);
  const enter = spring({frame, fps, config: {damping: 28, stiffness: 105, mass: 0.75}});
  const exit = interpolate(frame, [Math.max(0, duration - 12), duration], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{
      background: job.plan.brand.surface,
      color: job.plan.brand.ink,
      fontFamily: font,
      padding: "96px 124px",
      justifyContent: "space-between",
      opacity: exit,
    }}>
      <div style={{display: "flex", gap: 13, alignItems: "center", fontSize: 21, fontWeight: 650, opacity: enter}}>
        <span style={{width: 11, height: 11, borderRadius: 20, background: job.plan.brand.primary}} />
        {job.plan.title.replace(/ launch$/i, "")}
      </div>
      <div style={{maxWidth: 1260}}>
        <div style={{fontSize: 76, lineHeight: 1.04, letterSpacing: "-0.045em", fontWeight: 640}}>
          {words.map((word, index) => {
            const reveal = spring({
              frame: frame - index * 2.2,
              fps,
              config: {damping: 26, stiffness: 125, mass: 0.72},
            });
            return <React.Fragment key={`${word}-${index}`}>
              <span style={{
                display: "inline-block",
                opacity: reveal,
                transform: `translateY(${24 * (1 - reveal)}px)`,
                filter: `blur(${5 * (1 - reveal)}px)`,
              }}>{word}</span>{index < words.length - 1 ? " " : null}
            </React.Fragment>;
          })}
        </div>
        {scene.support ? <div style={{
          fontSize: 27, lineHeight: 1.42, marginTop: 32,
          opacity: 0.62 * enter, transform: `translateY(${12 * (1 - enter)}px)`,
        }}>{scene.support}</div> : null}
      </div>
      <div style={{fontSize: 15, letterSpacing: "0.08em", opacity: 0.42}}>
        {scene.role} · directed cut
      </div>
    </AbsoluteFill>
  );
};

const SceneLabel: React.FC<{scene: Scene; job: RenderJob}> = ({scene, job}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const reveal = spring({frame: frame - Math.round(fps * 0.18), fps, config: {damping: 24, stiffness: 92}});
  return (
    <div style={{
      position: "absolute",
      left: 48,
      top: 42,
      maxWidth: 520,
      padding: "16px 18px",
      borderRadius: 8,
      background: "rgba(245,247,242,.94)",
      color: job.plan.brand.ink,
      boxShadow: "0 18px 48px rgba(0,0,0,.18)",
      opacity: reveal,
      transform: `translateY(${10 * (1 - reveal)}px)`,
      fontFamily: font,
    }}>
      <div style={{
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: job.plan.brand.primary,
        fontWeight: 750,
        marginBottom: 9,
      }}>{scene.role}</div>
      <div style={{fontSize: 26, lineHeight: 1.12, fontWeight: 720}}>{scene.headline}</div>
      {scene.support ? <div style={{fontSize: 14, lineHeight: 1.35, color: "#5F665F", marginTop: 8}}>{scene.support}</div> : null}
    </div>
  );
};

const Cursor: React.FC<{
  event: CaptureEvent;
  viewport: RenderJob["capture"]["viewport"];
  sourceFromMs: number;
  color: string;
}> = ({event, viewport, sourceFromMs, color}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  if (!event.rect) return null;
  const targetX = (event.rect.x + event.rect.width / 2) / viewport.width * width;
  const targetY = (event.rect.y + event.rect.height / 2) / viewport.height * height;
  const eventFrame = Math.max(0, Math.round((event.atMs - sourceFromMs) / 1000 * fps));
  const arrive = spring({
    frame: frame - Math.max(0, eventFrame - Math.round(fps * 0.42)),
    fps,
    config: {damping: 26, stiffness: 95, mass: 0.72},
  });
  const x = interpolate(arrive, [0, 1], [targetX - Math.min(96, width * 0.06), targetX]);
  const y = interpolate(arrive, [0, 1], [targetY - Math.min(64, height * 0.06), targetY]);
  const clickAge = frame - eventFrame;
  const ring = event.kind === "click" && clickAge >= 0 && clickAge <= 9
    ? interpolate(clickAge, [0, 9], [0, 1])
    : null;
  const press = event.kind === "click" && clickAge >= -1 && clickAge <= 4
    ? interpolate(clickAge, [-1, 1, 4], [1, 0.91, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})
    : 1;
  return (
    <>
      {ring !== null ? <div style={{
        position: "absolute", left: x - 10 - ring * 9, top: y - 10 - ring * 9,
        width: 20 + ring * 18, height: 20 + ring * 18, borderRadius: 999,
        border: `2px solid ${color}`, opacity: 1 - ring,
      }} /> : null}
      <svg viewBox="0 0 32 40" width="32" height="40" style={{
        position: "absolute", left: x, top: y, transform: `translate(-3px,-2px) scale(${press * 1.16})`,
        transformOrigin: "3px 2px",
        filter: "drop-shadow(0 4px 10px rgba(0,0,0,.52))",
      }}>
        <path d="M3 2v29l8-7 6 13 5-3-6-12h11z" fill="white" stroke={color} strokeWidth="2"/>
      </svg>
    </>
  );
};

const TargetHighlight: React.FC<{
  event: CaptureEvent;
  viewport: RenderJob["capture"]["viewport"];
  color: string;
}> = ({event, viewport, color}) => {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  if (!event.rect) return null;
  const pulse = spring({frame, fps, config: {damping: 24, stiffness: 85}});
  const left = event.rect.x / viewport.width * width;
  const top = event.rect.y / viewport.height * height;
  const rectWidth = event.rect.width / viewport.width * width;
  const rectHeight = event.rect.height / viewport.height * height;
  return (
    <div style={{
      position: "absolute",
      left: left - 8,
      top: top - 8,
      width: rectWidth + 16,
      height: rectHeight + 16,
      borderRadius: 10,
      border: `2px solid ${color}`,
      boxShadow: `0 0 0 ${8 * pulse}px rgba(30,143,225,${0.16 * (1 - pulse)})`,
      opacity: 0.8,
    }} />
  );
};

const Product: React.FC<{scene: Scene; job: RenderJob}> = ({scene, job}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const duration = Math.round(scene.durationMs / 1000 * fps);
  const sourceFromMs = scene.source?.fromMs ?? 0;
  const sourceToMs = scene.source?.toMs ?? sourceFromMs + scene.durationMs;
  const sceneEvents = job.capture.events
    .filter((candidate) => candidate.rect && candidate.atMs >= sourceFromMs - 400 && candidate.atMs <= sourceToMs + 800)
    .sort((left, right) => left.atMs - right.atMs);
  const plannedEvent = job.capture.events.find((candidate) => scene.focusEventIds.includes(candidate.id));
  const currentSourceMs = sourceFromMs + frame / fps * 1000;
  const event = sceneEvents
    .filter((candidate) => candidate.atMs <= currentSourceMs + 600)
    .at(-1) ?? sceneEvents[0] ?? plannedEvent;
  const eventFrame = plannedEvent ? Math.max(0, Math.round((plannedEvent.atMs - sourceFromMs) / 1000 * fps)) : Math.round(duration * 0.42);
  const focus = spring({
    frame: frame - Math.max(0, eventFrame - Math.round(fps * 0.5)),
    fps,
    config: {damping: 30, stiffness: 82, mass: 0.82},
  });
  const release = interpolate(frame, [Math.max(0, duration - Math.round(fps * 0.45)), duration], [1, 0], {
    easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const cameraProgress = focus * release;
  const scale = interpolate(cameraProgress, [0, 1], [1, Math.min(scene.camera.to.scale, 1.12)]);
  const x = interpolate(cameraProgress, [0, 1], [0, scene.camera.to.x * 0.16]) / job.capture.viewport.width * width;
  const y = interpolate(cameraProgress, [0, 1], [0, scene.camera.to.y * 0.16]) / job.capture.viewport.height * height;
  const reveal = interpolate(frame, [0, Math.min(6, duration), Math.max(6, duration - 5), duration], [0, 1, 1, 0], {
    easing: Easing.inOut(Easing.quad), extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{background: "#0B0D0B", overflow: "hidden", opacity: reveal}}>
      <AbsoluteFill style={{transform: `translate(${x}px,${y}px) scale(${scale})`, transformOrigin: "center"}}>
        <Video
          src={job.capture.videoUrl}
          startFrom={Math.round((scene.source?.fromMs ?? 0) / 1000 * fps)}
          style={{width: "100%", height: "100%", objectFit: "cover", filter: "brightness(1.16) contrast(1.08) saturate(1.04)"}}
        />
      </AbsoluteFill>
      <div style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(180deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,.12) 100%)",
        pointerEvents: "none",
      }} />
      <SceneLabel scene={scene} job={job} />
      {event ? <TargetHighlight event={event} viewport={job.capture.viewport} color={job.plan.brand.primary} /> : null}
      {event ? <Cursor event={event} viewport={job.capture.viewport} sourceFromMs={sourceFromMs} color={job.plan.brand.primary} /> : null}
    </AbsoluteFill>
  );
};

export const LaunchFilm: React.FC<{job: RenderJob}> = ({job}) => {
  const {fps} = useVideoConfig();
  return <AbsoluteFill>{job.plan.scenes.map((scene) => {
    const editorial = false;
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
