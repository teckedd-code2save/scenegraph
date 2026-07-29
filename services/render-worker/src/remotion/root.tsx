import React from "react";
import {Composition} from "remotion";
import type {RenderJob} from "@scenegraph/contracts";
import {LaunchFilm} from "./film.js";

export const SceneGraphRoot: React.FC = () => (
  <Composition
    id="LaunchFilm"
    component={LaunchFilm}
    width={1920}
    height={1080}
    fps={60}
    durationInFrames={3600}
    defaultProps={{job: {} as RenderJob}}
    calculateMetadata={({props}) => ({
      durationInFrames: Math.ceil(
        props.job.plan.scenes.reduce((end, scene) => Math.max(end, scene.startMs + scene.durationMs), 0) / 1000 * 60,
      ),
      props,
    })}
  />
);
