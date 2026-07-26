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

export type ShowcaseTheme = "light" | "dark";

interface Palette {
  glow: string;
  grid: string;
  ink: string;
  muted: string;
  paper: string;
}

interface DemoConfig {
  appDuration: number;
  appTrimBefore: number;
  clip: string;
  matchLabelEnd: number;
  scraperLabelEnd: number;
}

const PALETTES: Record<ShowcaseTheme, Palette> = {
  light: {
    glow: "rgba(16,185,129,0.1)",
    grid: "rgba(16,185,129,0.055)",
    ink: "#10131a",
    muted: "#697386",
    paper: "#f6f7f9",
  },
  dark: {
    glow: "rgba(16,185,129,0.12)",
    grid: "rgba(16,185,129,0.075)",
    ink: "#f4f7fb",
    muted: "#9aa4b5",
    paper: "#080a0e",
  },
};

const DEMO_CONFIGS: Record<ShowcaseTheme, DemoConfig> = {
  light: {
    appDuration: 1326,
    appTrimBefore: 51,
    clip: "clips/continuous-flow-light-v5.mp4",
    matchLabelEnd: 779,
    scraperLabelEnd: 442,
  },
  dark: {
    appDuration: 1326,
    appTrimBefore: 51,
    clip: "clips/continuous-flow-dark-v5.mp4",
    matchLabelEnd: 782,
    scraperLabelEnd: 445,
  },
};

const INTRO_DURATION = 75;
const OUTRO_DURATION = 120;

export const LIGHT_SHOWCASE_DURATION =
  INTRO_DURATION + DEMO_CONFIGS.light.appDuration + OUTRO_DURATION;
export const DARK_SHOWCASE_DURATION =
  INTRO_DURATION + DEMO_CONFIGS.dark.appDuration + OUTRO_DURATION;

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

const Background = ({
  palette,
}: {
  palette: Palette;
}) => (
  <AbsoluteFill
    style={{
      backgroundColor: palette.paper,
      backgroundImage: `
        radial-gradient(circle at 50% 43%, ${palette.glow}, transparent 34%),
        linear-gradient(${palette.grid} 1px, transparent 1px),
        linear-gradient(90deg, ${palette.grid} 1px, transparent 1px)
      `,
      backgroundSize: "auto, 52px 52px, 52px 52px",
    }}
  />
);

const Brand = ({ palette }: { palette: Palette }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
    <Img
      src={switchyLogo}
      style={{ width: 72, height: 72, objectFit: "contain" }}
    />
    <span
      style={{
        color: palette.ink,
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

const Intro = ({ palette }: { palette: Palette }) => {
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
      <Background palette={palette} />
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
        <Brand palette={palette} />
        <h1
          style={{
            margin: "28px 0 10px",
            color: palette.ink,
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
            color: palette.muted,
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
        background: "rgba(5,8,12,0.66)",
        backdropFilter: "blur(14px)",
        boxShadow: "0 10px 32px rgba(0,0,0,0.24)",
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

const ContinuousDemo = ({
  config,
}: {
  config: DemoConfig;
}) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <Video
        src={staticFile(config.clip)}
        trimBefore={config.appTrimBefore}
        muted
        objectFit="cover"
        style={{
          width: "100%",
          height: "100%",
          opacity: sceneOpacity(frame, config.appDuration, 8, 8),
        }}
      />

      <Sequence from={0} durationInFrames={config.scraperLabelEnd}>
        <FeatureLabel
          chapter="01 · Job scraper"
          duration={config.scraperLabelEnd}
          summary="Discover and search newly found opportunities"
        />
      </Sequence>
      <Sequence
        from={config.scraperLabelEnd}
        durationInFrames={config.matchLabelEnd - config.scraperLabelEnd}
      >
        <FeatureLabel
          chapter="02 · Match analysis"
          duration={config.matchLabelEnd - config.scraperLabelEnd}
          summary="Review strengths, evidence, and gaps"
        />
      </Sequence>
      <Sequence
        from={config.matchLabelEnd}
        durationInFrames={config.appDuration - config.matchLabelEnd}
      >
        <FeatureLabel
          chapter="03 · Cover letters"
          duration={config.appDuration - config.matchLabelEnd}
          summary="Generate and refine a tailored draft"
        />
      </Sequence>
    </AbsoluteFill>
  );
};

const Closing = ({ palette }: { palette: Palette }) => {
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
      <Background palette={palette} />
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
        <Brand palette={palette} />
        <h2
          style={{
            margin: "28px 0 10px",
            color: palette.ink,
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
            color: palette.muted,
            fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
            fontSize: 28,
          }}
        >
          Explore the code and run it your way.
        </p>
        <div
          style={{
            marginTop: 27,
            color: "#10b981",
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

export const SwitchyShowcaseLive = ({
  theme,
}: {
  theme: ShowcaseTheme;
}) => {
  const config = DEMO_CONFIGS[theme];
  const palette = PALETTES[theme];
  const duration =
    INTRO_DURATION + config.appDuration + OUTRO_DURATION;

  return (
    <AbsoluteFill
      style={{
        background: palette.paper,
        fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
      }}
    >
      <Audio
        src={staticFile("music/house-02.mp3")}
        volume={(frame) =>
          interpolate(
            frame,
            [0, 28, duration - 90, duration - 1],
            [0, 0.34, 0.34, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }
          )
        }
      />

      <Sequence from={0} durationInFrames={INTRO_DURATION}>
        <Intro palette={palette} />
      </Sequence>
      <Sequence from={INTRO_DURATION} durationInFrames={config.appDuration}>
        <ContinuousDemo config={config} />
      </Sequence>
      <Sequence
        from={INTRO_DURATION + config.appDuration}
        durationInFrames={OUTRO_DURATION}
      >
        <Closing palette={palette} />
      </Sequence>
    </AbsoluteFill>
  );
};
