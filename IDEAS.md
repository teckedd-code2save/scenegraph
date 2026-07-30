# SceneGraph — Feature & Research Roadmap

> Forward-looking ideas for SceneGraph, organised by product layer. Not all will ship; they're documented here to surface design tension and invite discussion.

---

## Capture & Recording

1. **Multi-tab capture** — Record across multiple browser tabs simultaneously and merge into a single timeline.
2. **Native desktop app recording** — Extend the recorder beyond browser tabs to capture native desktop applications (SparkCapture-style injection).
3. **Mobile device capture** — On-device Android/iOS recorder that streams DOM-mapped events back to the studio.
4. **Camera overlay** — Optional webcam PiP (picture-in-picture) recording alongside the screen capture for presenter reactions.
5. **Microphone voiceover** — Record a voice track during capture that can be used in the final film alongside or instead of synthetic narration.
6. **Selective re-recording** — Replace a single scene in an existing project without re-recording the entire walkthrough.

## Studio & Direction

7. **Scene script editor** — Free-form text editor for writing and editing the narrative script, with the director auto-generating camera directions from the text.
8. **Storyboard view** — A grid of keyframe thumbnails showing every camera position across the film, drag-reorderable.
9. **Transition library** — Pre-built scene transitions (slide, fade, zoom, wipe) that can be applied between any two editorial cards.
10. **Annotation overlay** — Draw arrows, circles, highlight regions, and text callouts on specific frames.
11. **Split-and-trim timeline** — Fine-cut editor at the scene level: trim head/tail, split scenes, adjust pacing between beats.
12. **Version history** — Track every saved project state, with the ability to diff, restore, or branch from any version.
13. **Collaborative editing** — Multiple users edit the same project simultaneously (operational transform or CRDT-based).

## Rendering & Performance

14. **GPU-accelerated rendering** — Leverage hardware encoding via NVENC/VAAPI/VideoToolbox to reduce render times from minutes to seconds.
15. **Progressive / preview render** — Low-resolution "draft mode" that renders in 10 seconds so the user can check composition before committing to a full export.
16. **Social format presets** — One-click export presets: TikTok 9:16, YouTube 16:9, Instagram Reel 9:16, Twitter/X square.
17. **GIF export** — Animated GIF output for quick social sharing, configurable frame rate and colour depth.
18. **Subtitled output** — Burn in auto-generated (or user-provided) subtitles as an SRT track or hard-coded overlay.

## AI & Automation

19. **Auto-narration from script** — Generate a synthetic voiceover from the scene script using TTS, synced to scene boundaries.
20. **AI highlight detection** — Analyse the captured interaction data to auto-detect "key moments" and suggest scene boundaries.
21. **GitHub trigger** — Auto-generate a launch film from a GitHub product release: read the release notes, capture from the product's staging environment, render, and post to a PR comment or Slack.
22. **Product brief → rough cut** — Feed a product brief and a URL to get a first-pass rough cut without manual recording. The director plans scenes, the render-worker composits screenshots into a draft film.

## Deployment & Operations

23. **Authentication & user accounts** — GitHub OAuth login, per-user project isolation, and project sharing via signed URLs.
24. **Durable storage** — Replace filesystem persistence with PostgreSQL/Turso for project data and S3-compatible object storage for recordings and renders.
25. **Usage-based pricing** — Free tier (3 films/month), paid tier for higher volume, team workspaces.
26. **Webhook API** — POST a capture event to receive a render callback, enabling CI/CD film pipelines without a human in the loop.
27. **Self-hosted deployment** — Docker Compose profile for teams that want SceneGraph running on their own infrastructure.

## Documentation & Quality of Life

28. **Interactive playground** — An in-browser demo that generates a sample film from a pre-recorded walkthrough, no signup required.
29. **AGENTS.md** — Agent guide covering workspace layout, build commands, architecture invariants, and contribution conventions.
30. **PENDINGS.md** — Known sharp edges and architectural constraints, surfaced for downstream contributors.

---

*This is a living document. Add ideas as they emerge; strike through or archive as they ship.*
