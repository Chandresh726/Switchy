import type { CSSProperties, ReactNode } from "react";

import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
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
  greenDark: "#08795a",
  greenSoft: "#d9f8ec",
  paper: "#f6f7f9",
  panel: "#ffffff",
  line: "#d9dee7",
};

const fadeForScene = (frame: number, duration: number) =>
  interpolate(
    frame,
    [0, 15, duration - 15, duration],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

const GridBackground = () => (
  <AbsoluteFill
    style={{
      backgroundColor: COLORS.paper,
      backgroundImage: `
        linear-gradient(rgba(16, 185, 129, 0.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(16, 185, 129, 0.06) 1px, transparent 1px)
      `,
      backgroundSize: "52px 52px",
    }}
  >
    <div
      style={{
        position: "absolute",
        width: 940,
        height: 940,
        borderRadius: "50%",
        top: -520,
        right: -280,
        background:
          "radial-gradient(circle, rgba(16,185,129,0.2), rgba(16,185,129,0) 68%)",
      }}
    />
    <div
      style={{
        position: "absolute",
        width: 760,
        height: 760,
        borderRadius: "50%",
        bottom: -520,
        left: -240,
        background:
          "radial-gradient(circle, rgba(16,185,129,0.12), rgba(16,185,129,0) 70%)",
      }}
    />
  </AbsoluteFill>
);

const Brand = ({ compact = false }: { compact?: boolean }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: compact ? 14 : 22,
    }}
  >
    <Img
      src={switchyLogo}
      style={{
        width: compact ? 44 : 78,
        height: compact ? 44 : 78,
        objectFit: "contain",
      }}
    />
    <span
      style={{
        color: COLORS.ink,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: compact ? 30 : 60,
        fontWeight: 760,
        letterSpacing: "-0.055em",
      }}
    >
      Switchy
    </span>
  </div>
);

interface SceneCopyProps {
  eyebrow: string;
  title: string;
  body: string;
}

const SceneCopy = ({ eyebrow, title, body }: SceneCopyProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({
    fps,
    frame,
    config: {
      damping: 18,
      mass: 0.8,
      stiffness: 120,
    },
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        top: 68,
        maxWidth: 1180,
        transform: `translateY(${interpolate(entrance, [0, 1], [28, 0])}px)`,
        opacity: entrance,
        zIndex: 3,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          color: COLORS.greenDark,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 19,
          fontWeight: 760,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        <span
          style={{
            width: 34,
            height: 3,
            background: COLORS.green,
          }}
        />
        {eyebrow}
      </div>
      <h2
        style={{
          margin: "13px 0 8px",
          color: COLORS.ink,
          fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
          fontSize: 62,
          fontWeight: 780,
          letterSpacing: "-0.048em",
          lineHeight: 1,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: 0,
          maxWidth: 980,
          color: COLORS.muted,
          fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
          fontSize: 25,
          fontWeight: 470,
          lineHeight: 1.35,
        }}
      >
        {body}
      </p>
    </div>
  );
};

interface CursorProps {
  x: number;
  y: number;
  pulse?: number;
}

const Cursor = ({ x, y, pulse = 0 }: CursorProps) => {
  const pulseScale = interpolate(pulse, [0, 0.5, 1], [0.2, 1, 1.5]);
  const pulseOpacity = interpolate(pulse, [0, 0.4, 1], [0, 0.42, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: 54,
        height: 68,
        transform: "translate(-9px, -7px)",
        zIndex: 5,
        filter: "drop-shadow(0 4px 5px rgba(0,0,0,0.22))",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 76,
          height: 76,
          left: -27,
          top: -27,
          borderRadius: "50%",
          border: `4px solid ${COLORS.green}`,
          transform: `scale(${pulseScale})`,
          opacity: pulseOpacity,
        }}
      />
      <svg viewBox="0 0 36 48" width="36" height="48">
        <path
          d="M4 3.2v34.4l8.7-8.2 6.2 14.3 7.1-3.2-6.2-13.9H32L4 3.2Z"
          fill="#ffffff"
          stroke="#10131a"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

interface BrowserFrameProps {
  image: string;
  style?: CSSProperties;
  cursor?: ReactNode;
  imageStyle?: CSSProperties;
}

const BrowserFrame = ({
  image,
  style,
  cursor,
  imageStyle,
}: BrowserFrameProps) => (
  <div
    style={{
      position: "absolute",
      left: 250,
      top: 250,
      width: 1570,
      height: 760,
      overflow: "hidden",
      border: `1px solid ${COLORS.line}`,
      borderRadius: 24,
      background: COLORS.panel,
      boxShadow:
        "0 36px 90px rgba(20, 29, 45, 0.16), 0 12px 28px rgba(20, 29, 45, 0.08)",
      ...style,
    }}
  >
    <div
      style={{
        height: 46,
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        gap: 10,
        borderBottom: `1px solid ${COLORS.line}`,
        background: "#fbfcfd",
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
        <span
          key={color}
          style={{
            width: 13,
            height: 13,
            borderRadius: "50%",
            background: color,
          }}
        />
      ))}
      <div
        style={{
          marginLeft: 18,
          padding: "7px 18px",
          minWidth: 310,
          borderRadius: 9,
          background: "#f0f3f6",
          color: "#727c8e",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 14,
        }}
      >
        localhost:3000
      </div>
    </div>
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "calc(100% - 46px)",
        overflow: "hidden",
      }}
    >
      <Img
        src={staticFile(`captures/${image}`)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "top left",
          ...imageStyle,
        }}
      />
      {cursor}
    </div>
  </div>
);

const IntroScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fadeForScene(frame, 90);
  const scale = spring({
    fps,
    frame,
    config: { damping: 18, stiffness: 105 },
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <GridBackground />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${interpolate(scale, [0, 1], [0.92, 1])})`,
        }}
      >
        <Brand />
        <div
          style={{
            width: 74,
            height: 5,
            margin: "38px 0 28px",
            background: COLORS.green,
          }}
        />
        <h1
          style={{
            margin: 0,
            color: COLORS.ink,
            fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
            fontSize: 74,
            fontWeight: 780,
            letterSpacing: "-0.052em",
          }}
        >
          Your job search command center.
        </h1>
      </div>
    </AbsoluteFill>
  );
};

const ScraperScene = () => {
  const frame = useCurrentFrame();
  const opacity = fadeForScene(frame, 330);
  const crossfade = interpolate(frame, [140, 174], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pointerX = interpolate(frame, [35, 130, 190, 290], [86, 86, 62, 73], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pointerY = interpolate(frame, [35, 130, 190, 290], [8, 8, 19, 38], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulse = interpolate(frame, [88, 100, 118], [0, 0.55, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <GridBackground />
      <SceneCopy
        eyebrow="01 · Smart scraping"
        title="Catch every new opening."
        body="Switchy watches company career pages and brings fresh roles into one searchable place."
      />
      <BrowserFrame
        image="dashboard.png"
        style={{
          opacity: 1 - crossfade,
          transform: `translateY(${interpolate(frame, [0, 330], [26, -6])}px)`,
        }}
        cursor={<Cursor x={pointerX} y={pointerY} pulse={pulse} />}
      />
      <BrowserFrame
        image="jobs.png"
        style={{
          opacity: crossfade,
          transform: `scale(${interpolate(crossfade, [0, 1], [1.02, 1])})`,
        }}
        cursor={<Cursor x={pointerX} y={pointerY} />}
      />
      <div
        style={{
          position: "absolute",
          right: 82,
          bottom: 58,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 22px",
          border: `1px solid ${COLORS.green}`,
          borderRadius: 14,
          background: "rgba(255,255,255,0.94)",
          color: COLORS.greenDark,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 19,
          fontWeight: 720,
          boxShadow: "0 12px 30px rgba(16,185,129,0.14)",
          opacity: interpolate(frame, [60, 90], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: COLORS.green,
          }}
        />
        38 new roles found
      </div>
    </AbsoluteFill>
  );
};

const MatchScene = () => {
  const frame = useCurrentFrame();
  const opacity = fadeForScene(frame, 360);
  const scale = interpolate(frame, [0, 360], [1, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });
  const pointerX = interpolate(frame, [50, 260], [78, 56], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pointerY = interpolate(frame, [50, 260], [14, 42], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <GridBackground />
      <SceneCopy
        eyebrow="02 · Match analysis"
        title="Know where you fit."
        body="See matched skills, gaps, and evidence before you spend time applying."
      />
      <BrowserFrame
        image="match-analysis.png"
        style={{ transform: `scale(${scale})` }}
        cursor={
          <Cursor
            x={pointerX}
            y={pointerY}
            pulse={interpolate(frame, [150, 168, 194], [0, 0.55, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />
        }
      />
      <div
        style={{
          position: "absolute",
          right: 92,
          bottom: 62,
          display: "flex",
          gap: 10,
        }}
      >
        {["Matched skills", "Evidence", "Gaps"].map((label, index) => (
          <span
            key={label}
            style={{
              padding: "12px 18px",
              borderRadius: 999,
              border: `1px solid ${COLORS.line}`,
              background: "rgba(255,255,255,0.95)",
              color: index === 0 ? COLORS.greenDark : COLORS.ink,
              fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
              fontSize: 17,
              fontWeight: 650,
              opacity: interpolate(
                frame,
                [80 + index * 16, 110 + index * 16],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }
              ),
              transform: `translateY(${interpolate(
                frame,
                [80 + index * 16, 110 + index * 16],
                [14, 0],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }
              )}px)`,
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const CoverLetterScene = () => {
  const frame = useCurrentFrame();
  const opacity = fadeForScene(frame, 360);
  const reveal = interpolate(frame, [70, 250], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <GridBackground />
      <SceneCopy
        eyebrow="03 · Cover letters"
        title="Turn insight into action."
        body="Create a tailored first draft grounded in the role and your experience."
      />
      <BrowserFrame
        image="cover-letter.png"
        cursor={
          <Cursor
            x={84}
            y={31}
            pulse={interpolate(frame, [35, 52, 80], [0, 0.55, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />
        }
      />
      <div
        style={{
          position: "absolute",
          left: 534,
          top: 484,
          width: 1030,
          height: 260,
          pointerEvents: "none",
          background: COLORS.panel,
          clipPath: `inset(${reveal}% 0 0 0)`,
          opacity: interpolate(frame, [60, 90], [0.88, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 92,
          bottom: 62,
          padding: "13px 20px",
          borderRadius: 14,
          border: `1px solid ${COLORS.green}`,
          background: "rgba(255,255,255,0.95)",
          color: COLORS.greenDark,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 18,
          fontWeight: 720,
          opacity: interpolate(frame, [180, 215], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Tailored draft ready
      </div>
    </AbsoluteFill>
  );
};

const ClosingScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fadeForScene(frame, 240);
  const entrance = spring({
    fps,
    frame,
    config: { damping: 18, stiffness: 100 },
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <GridBackground />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 1380,
            padding: "72px 84px",
            borderRadius: 34,
            border: `1px solid ${COLORS.line}`,
            background: "rgba(255,255,255,0.9)",
            boxShadow: "0 34px 90px rgba(20,29,45,0.14)",
            transform: `translateY(${interpolate(
              entrance,
              [0, 1],
              [34, 0]
            )}px)`,
            opacity: entrance,
          }}
        >
          <Brand compact />
          <h2
            style={{
              margin: "32px 0 16px",
              color: COLORS.ink,
              fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
              fontSize: 82,
              fontWeight: 790,
              letterSpacing: "-0.055em",
              lineHeight: 1,
            }}
          >
            Open source. Local first.
          </h2>
          <p
            style={{
              margin: 0,
              maxWidth: 1100,
              color: COLORS.muted,
              fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
              fontSize: 30,
              lineHeight: 1.45,
            }}
          >
            Self-host Switchy and keep your job search data on your machine.
          </p>
          <div
            style={{
              marginTop: 42,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", gap: 12 }}>
              {["Scrape", "Match", "Apply"].map((label) => (
                <span
                  key={label}
                  style={{
                    padding: "13px 20px",
                    borderRadius: 999,
                    background: COLORS.greenSoft,
                    color: COLORS.greenDark,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 18,
                    fontWeight: 720,
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "18px 25px",
                borderRadius: 14,
                background: COLORS.green,
                color: "#04140f",
                fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
                fontSize: 22,
                fontWeight: 760,
              }}
            >
              View on GitHub
              <span style={{ fontSize: 28, lineHeight: 1 }}>→</span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const SwitchyShowcase = () => {
  return (
    <AbsoluteFill
      style={{
        background: COLORS.paper,
        fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
      }}
    >
      <Audio
        src={staticFile("music/close-up.mp3")}
        volume={(audioFrame) =>
          interpolate(
            audioFrame,
            [0, 40, 1240, 1319],
            [0, 0.45, 0.45, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }
          )
        }
        trimBefore={135}
      />
      <Sequence from={0} durationInFrames={90}>
        <IntroScene />
      </Sequence>
      <Sequence from={75} durationInFrames={330}>
        <ScraperScene />
      </Sequence>
      <Sequence from={390} durationInFrames={360}>
        <MatchScene />
      </Sequence>
      <Sequence from={735} durationInFrames={360}>
        <CoverLetterScene />
      </Sequence>
      <Sequence from={1080} durationInFrames={240}>
        <ClosingScene />
      </Sequence>
    </AbsoluteFill>
  );
};

export const ShowcasePoster = () => (
  <AbsoluteFill>
    <GridBackground />
    <div
      style={{
        position: "absolute",
        left: 92,
        top: 72,
        zIndex: 3,
      }}
    >
      <Brand compact />
      <h1
        style={{
          margin: "26px 0 12px",
          maxWidth: 900,
          color: COLORS.ink,
          fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
          fontSize: 74,
          fontWeight: 790,
          letterSpacing: "-0.052em",
          lineHeight: 1,
        }}
      >
        Your job search command center.
      </h1>
      <p
        style={{
          margin: 0,
          color: COLORS.muted,
          fontFamily: "Inter, SF Pro Text, system-ui, sans-serif",
          fontSize: 26,
        }}
      >
        Scrape fresh roles. Understand your fit. Apply with confidence.
      </p>
    </div>
    <BrowserFrame
      image="dashboard.png"
      style={{
        left: 380,
        top: 350,
        width: 1480,
        height: 700,
        transform: "rotate(-1.2deg)",
      }}
    />
  </AbsoluteFill>
);
