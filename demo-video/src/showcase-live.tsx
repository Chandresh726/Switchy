import { Audio, Video } from "@remotion/media";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import switchyLogo from "../../landing/public/switchy-logo.png";

const COLORS = {
  ink: "#10131a",
  muted: "#697386",
  green: "#10b981",
  paper: "#f6f7f9",
};

const INTRO_DURATION = 75;
const APP_TRIM_BEFORE = 51;
const APP_DURATION = 1260;
const OUTRO_DURATION = 120;
const SCRAPER_LABEL_END = 428;
const MATCH_LABEL_END = 751;

export const SHOWCASE_DURATION =
  INTRO_DURATION + APP_DURATION + OUTRO_DURATION;

const sceneOpacity = (
  frame: number,
  duration: number,
  fadeIn = 10,
  fadeOut = 10
) =>
  interpolate(
    frame,
    [0, fadeIn, duration - fadeOut, duration],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

const Background = () => (
  <AbsoluteFill
    style={{
      backgroundColor: COLORS.paper,
      backgroundImage: `
        radial-gradient(circle at 50% 43%, rgba(16,185,129,0.1), transparent 34%),
        linear-gradient(rgba(16,185,129,0.055) 1px, transparent 1px),
        linear-gradient(90deg, rgba(16,185,129,0.055) 1px, transparent 1px)
      `,
      backgroundSize: "auto, 52px 52px, 52px 52px",
    }}
  />
);

const Brand = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
    <Img
      src={switchyLogo}
      style={{ width: 72, height: 72, objectFit: "contain" }}
    />
    <span
      style={{
        color: COLORS.ink,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 56,
        fontWeight: 780,
        letterSpacing: "-0.055em",
      }}
    >
      Switchy
    </span>
  </div>
);

const Intro = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({
    frame,
    fps,
    config: { damping: 18, mass: 0.8, stiffness: 115 },
  });

  return (
    <AbsoluteFill
      style={{ opacity: sceneOpacity(frame, INTRO_DURATION, 12, 9) }}
    >
      <Background />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: entrance,
          transform: `translateY(${interpolate(
            entrance,
            [0, 1],
            [22, 0]
          )}px)`,
        }}
      >
        <Brand />
        <h1
          style={{
            margin: "28px 0 10px",
            color: COLORS.ink,
            fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
            fontSize: 72,
            fontWeight: 790,
            letterSpacing: "-0.052em",
          }}
        >
          From career pages to confident applications.
        </h1>
        <p
          style={{
            margin: 0,
            color: COLORS.muted,
            fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
            fontSize: 27,
          }}
        >
          Discover new roles, understand your fit, and apply with confidence.
        </p>
      </div>
    </AbsoluteFill>
  );
};

interface FeatureLabelProps {
  chapter: string;
  duration: number;
  summary: string;
}

const FeatureLabel = ({
  chapter,
  duration,
  summary,
}: FeatureLabelProps) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, 12, Math.max(13, duration - 12), duration],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 38,
        display: "flex",
        alignItems: "center",
        gap: 11,
        maxWidth: 760,
        padding: "10px 16px",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 999,
        background: "rgba(16,19,26,0.56)",
        backdropFilter: "blur(14px)",
        boxShadow: "0 10px 32px rgba(16,19,26,0.18)",
        opacity,
        transform: `translate(-50%, ${interpolate(
          opacity,
          [0, 1],
          [8, 0]
        )}px)`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          color: "#6ee7b7",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 15,
          fontWeight: 760,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {chapter}
      </span>
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.54)",
        }}
      />
      <span
        style={{
          color: "rgba(255,255,255,0.92)",
          fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
          fontSize: 16,
          fontWeight: 560,
        }}
      >
        {summary}
      </span>
    </div>
  );
};

const ContinuousDemo = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: "#ffffff" }}>
      <Video
        src={staticFile("clips/continuous-flow-v4.mp4")}
        trimBefore={APP_TRIM_BEFORE}
        muted
        objectFit="cover"
        style={{
          width: "100%",
          height: "100%",
          opacity: sceneOpacity(frame, APP_DURATION, 8, 8),
        }}
      />

      <Sequence from={0} durationInFrames={SCRAPER_LABEL_END}>
        <FeatureLabel
          chapter="01 · Job scraper"
          duration={SCRAPER_LABEL_END}
          summary="Discover and search newly found opportunities"
        />
      </Sequence>
      <Sequence
        from={SCRAPER_LABEL_END}
        durationInFrames={MATCH_LABEL_END - SCRAPER_LABEL_END}
      >
        <FeatureLabel
          chapter="02 · Match analysis"
          duration={MATCH_LABEL_END - SCRAPER_LABEL_END}
          summary="Review strengths, evidence, and gaps"
        />
      </Sequence>
      <Sequence
        from={MATCH_LABEL_END}
        durationInFrames={APP_DURATION - MATCH_LABEL_END}
      >
        <FeatureLabel
          chapter="03 · Cover letters"
          duration={APP_DURATION - MATCH_LABEL_END}
          summary="Generate and refine a tailored draft"
        />
      </Sequence>
    </AbsoluteFill>
  );
};

const Closing = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({
    frame,
    fps,
    config: { damping: 18, mass: 0.8, stiffness: 110 },
  });

  return (
    <AbsoluteFill
      style={{ opacity: sceneOpacity(frame, OUTRO_DURATION, 12, 12) }}
    >
      <Background />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: entrance,
          transform: `translateY(${interpolate(
            entrance,
            [0, 1],
            [22, 0]
          )}px)`,
        }}
      >
        <Brand />
        <h2
          style={{
            margin: "28px 0 10px",
            color: COLORS.ink,
            fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
            fontSize: 72,
            fontWeight: 790,
            letterSpacing: "-0.052em",
          }}
        >
          Switchy is open source.
        </h2>
        <p
          style={{
            margin: 0,
            color: COLORS.muted,
            fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
            fontSize: 28,
          }}
        >
          Explore the code and run it your way.
        </p>
        <div
          style={{
            marginTop: 27,
            color: COLORS.green,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 25,
            fontWeight: 720,
          }}
        >
          github.com/Chandresh726/Switchy
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const SwitchyShowcaseLive = () => (
  <AbsoluteFill
    style={{
      background: COLORS.paper,
      fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
    }}
  >
    <Audio
      src={staticFile("music/close-up.mp3")}
      volume={(frame) =>
        interpolate(
          frame,
          [0, 28, SHOWCASE_DURATION - 90, SHOWCASE_DURATION - 1],
          [0, 0.42, 0.42, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }
        )
      }
      trimBefore={135}
    />

    <Sequence from={0} durationInFrames={INTRO_DURATION}>
      <Intro />
    </Sequence>
    <Sequence from={INTRO_DURATION} durationInFrames={APP_DURATION}>
      <ContinuousDemo />
    </Sequence>
    <Sequence
      from={INTRO_DURATION + APP_DURATION}
      durationInFrames={OUTRO_DURATION}
    >
      <Closing />
    </Sequence>
  </AbsoluteFill>
);
