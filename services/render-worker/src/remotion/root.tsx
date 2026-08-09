import React from "react";
import {Composition} from "remotion";
import type {RenderJob} from "@scenegraph/contracts";
import {LaunchFilm} from "./film.js";

export const SceneGraphRoot: React.FC = () => (
  <Composition
    id="LaunchFilm"
    component={LaunchFilm}
    width={1280}
    height={720}
    fps={30}
    durationInFrames={3600}
    defaultProps={{job: {} as RenderJob}}
    calculateMetadata={({props}) => ({
      width: props.job.output.width,
      height: props.job.output.height,
      fps: props.job.output.fps,
      durationInFrames: Math.ceil(
        props.job.plan.scenes.reduce((end, scene) => Math.max(end, scene.startMs + scene.durationMs), 0) / 1000 * props.job.output.fps,
      ),
      props,
    })}
  />
);
