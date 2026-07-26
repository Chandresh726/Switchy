import { Navbar } from "@/components/navbar";
import { Hero } from "@/components/hero";
import { ProductDemo } from "@/components/product-demo";
import { Features } from "@/components/features";
import { HowItWorks } from "@/components/how-it-works";
import { TechStack } from "@/components/tech-stack";
import { SupportedPlatforms } from "@/components/supported-platforms";
import { SectionDivider } from "@/components/section-divider";
import { SetupGuide } from "@/components/setup-guide";
import { FAQ } from "@/components/faq";
import { Footer } from "@/components/footer";

export default function LandingPage() {
  return (
    <main className="relative">
      <Navbar />
      <Hero />
      <ProductDemo />
      <SectionDivider top="grid" bottom="plain" />
      <Features />
      <SectionDivider top="plain" bottom="grid" />
      <HowItWorks />
      <SectionDivider top="grid" bottom="plain" />
      <TechStack />
      <SectionDivider top="plain" bottom="grid" />
      <SupportedPlatforms />
      <SectionDivider top="grid" bottom="plain" />
      <SetupGuide />
      <FAQ />
      <Footer />
    </main>
  );
}
