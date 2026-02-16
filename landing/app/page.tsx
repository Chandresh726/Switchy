import { Navbar } from "@/components/navbar";
import { Hero } from "@/components/hero";
import { Screenshots } from "@/components/screenshots";
import { Features } from "@/components/features";
import { HowItWorks } from "@/components/how-it-works";
import { TechStack } from "@/components/tech-stack";
import { SetupGuide } from "@/components/setup-guide";
import { FAQ } from "@/components/faq";
import { Footer } from "@/components/footer";

export default function LandingPage() {
  return (
    <main className="relative">
      <Navbar />
      <Hero />
      <Screenshots />
      <Features />
      <HowItWorks />
      <TechStack />
      <SetupGuide />
      <FAQ />
      <Footer />
    </main>
  );
}
