"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { SCREENSHOTS } from "@/lib/constants";
import { fadeInY, imageSlide } from "@/lib/animations";

export function Screenshots() {
  const [currentFeatureIndex, setCurrentFeatureIndex] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const currentFeature = SCREENSHOTS[currentFeatureIndex];
  const currentImage = currentFeature.images[currentImageIndex];

  const totalImages = SCREENSHOTS.reduce(
    (acc, feature) => acc + feature.images.length,
    0
  );

  // Calculate flat index for dots
  const getFlatIndex = useCallback(() => {
    let flatIndex = 0;
    for (let i = 0; i < currentFeatureIndex; i++) {
      flatIndex += SCREENSHOTS[i].images.length;
    }
    flatIndex += currentImageIndex;
    return flatIndex;
  }, [currentFeatureIndex, currentImageIndex]);

  // Navigate to a specific flat index (for dots)
  const navigateToFlatIndex = useCallback((flatIndex: number) => {
    let currentFlatIndex = 0;
    for (let i = 0; i < SCREENSHOTS.length; i++) {
      for (let j = 0; j < SCREENSHOTS[i].images.length; j++) {
        if (currentFlatIndex === flatIndex) {
          setCurrentFeatureIndex(i);
          setCurrentImageIndex(j);
          return;
        }
        currentFlatIndex++;
      }
    }
  }, []);

  // Move to next image/feature
  const handleNext = useCallback(() => {
    if (currentImageIndex < currentFeature.images.length - 1) {
      // Next image in current feature
      setCurrentImageIndex((prev) => prev + 1);
    } else {
      // Move to next feature
      setCurrentFeatureIndex((prev) => (prev + 1) % SCREENSHOTS.length);
      setCurrentImageIndex(0);
    }
  }, [currentFeature.images.length, currentImageIndex]);

  // Move to previous image/feature
  const handlePrev = useCallback(() => {
    if (currentImageIndex > 0) {
      // Previous image in current feature
      setCurrentImageIndex((prev) => prev - 1);
    } else {
      // Move to previous feature's last image
      const newFeatureIndex =
        (currentFeatureIndex - 1 + SCREENSHOTS.length) % SCREENSHOTS.length;
      setCurrentFeatureIndex(newFeatureIndex);
      setCurrentImageIndex(SCREENSHOTS[newFeatureIndex].images.length - 1);
    }
  }, [currentFeatureIndex, currentImageIndex]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting && entry.intersectionRatio >= 0.99);
        });
      },
      { threshold: 0.99 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isVisible) {
      intervalRef.current = setInterval(() => {
        handleNext();
      }, 5000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isVisible, handleNext]);

  const currentFlatIndex = getFlatIndex();

  return (
    <section ref={sectionRef} className="relative px-6 pb-4 grid-bg">
      <div className="w-full max-w-5xl mx-auto">
        <motion.div
          variants={fadeInY}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.8 }}
          className="w-full"
        >
          <div className="border-2 border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b-2 border-[var(--border-color)] bg-[var(--bg-primary)]">
              <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
              <div className="w-3 h-3 rounded-full bg-[#28c840]" />
              <span className="ml-4 text-xs text-[var(--text-primary)] font-mono">
                {currentImage.url}
              </span>
            </div>

            <div className="relative aspect-[16/9] bg-[var(--bg-tertiary)] overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.img
                  key={`${currentFeatureIndex}-${currentImageIndex}`}
                  variants={imageSlide}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.3 }}
                  src={currentImage.src}
                  alt={currentFeature.title}
                  className="absolute inset-0 w-full h-full object-cover object-top"
                  loading="lazy"
                />
              </AnimatePresence>
            </div>
          </div>

          <div
            className="flex items-center justify-center gap-2 mt-4"
            role="tablist"
            aria-label="Screenshot navigation"
          >
            {Array.from({ length: totalImages }).map((_, index) => (
              <button
                key={index}
                onClick={() => navigateToFlatIndex(index)}
                className={`h-2 transition-all duration-300 ${
                  index === currentFlatIndex
                    ? "w-6 bg-[#10b981]"
                    : "w-2 bg-[var(--border-color)]"
                }`}
                aria-label={`Go to screenshot ${index + 1}`}
                aria-selected={index === currentFlatIndex}
                role="tab"
              />
            ))}
          </div>

          <div className="border-2 border-[var(--border-color)] bg-[var(--bg-primary)] p-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="text-left">
                <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">
                  {currentFeature.title}
                </h3>
                <p className="text-[var(--text-secondary)] text-sm mt-1">
                  {currentFeature.description}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrev}
                  className="w-10 h-10 flex items-center justify-center border-2 border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                  aria-label="Previous screenshot"
                >
                  <ArrowLeft className="w-5 h-5 text-[var(--text-primary)]" />
                </button>
                <button
                  onClick={handleNext}
                  className="w-10 h-10 flex items-center justify-center border-2 border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                  aria-label="Next screenshot"
                >
                  <ArrowRight className="w-5 h-5 text-[var(--text-primary)]" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
