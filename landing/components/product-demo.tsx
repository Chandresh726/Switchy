"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { motion, useReducedMotion } from "framer-motion";
import { Play } from "lucide-react";

import { useTheme } from "@/lib/use-theme";

interface VideoStageProps {
  theme: "dark" | "light";
}

function VideoStage({ theme }: VideoStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const videoSrc = `/videos/switchy-showcase-${theme}.mp4`;
  const posterSrc = `/videos/switchy-showcase-${theme}-poster.jpg`;

  const playVideo = () => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = 0.5;
    setHasStarted(true);
    void video.play().catch(() => {
      setHasStarted(false);
      setHasPlaybackStarted(false);
    });
  };

  return (
    <div className="group relative aspect-video overflow-hidden bg-black">
      <Image
        src={posterSrc}
        alt=""
        fill
        priority
        sizes="(max-width: 768px) calc(100vw - 2rem), 1152px"
        aria-hidden
        className={`pointer-events-none z-10 object-cover transition-opacity duration-300 ${
          hasPlaybackStarted ? "opacity-0" : "opacity-100"
        }`}
      />

      <video
        ref={videoRef}
        aria-label={`Switchy product walkthrough in ${theme} mode`}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          hasPlaybackStarted ? "opacity-100" : "opacity-0"
        }`}
        controls={hasPlaybackStarted}
        onEnded={() => {
          setHasStarted(false);
          setHasPlaybackStarted(false);
        }}
        onPlaying={() => setHasPlaybackStarted(true)}
        playsInline
        poster={posterSrc}
        preload="none"
        src={videoSrc}
      >
        Your browser does not support embedded video.
      </video>

      {!hasStarted ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/10 group-hover:opacity-100 group-focus-within:bg-black/10 group-focus-within:opacity-100 [@media(hover:none)]:bg-black/10 [@media(hover:none)]:opacity-100">
          <button
            type="button"
            onClick={playVideo}
            className="geo-card-solid pointer-events-auto grid h-16 w-16 place-items-center text-black focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#10b981]/60"
            aria-label="Play the Switchy product walkthrough"
          >
            <Play aria-hidden className="h-6 w-6 translate-x-px fill-current" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ProductDemo() {
  const { theme } = useTheme();
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="demo"
      className="relative scroll-mt-24 px-4 pb-8 grid-bg md:px-6 md:pb-28"
    >
      <div className="mx-auto w-full max-w-6xl">
        <motion.div
          className="video-glow"
          initial={
            shouldReduceMotion
              ? { opacity: 1, y: 0 }
              : { opacity: 0, y: 30 }
          }
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: shouldReduceMotion ? 0 : 0.4,
            duration: shouldReduceMotion ? 0 : 0.6,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          <VideoStage key={theme} theme={theme} />
        </motion.div>
      </div>
    </section>
  );
}
