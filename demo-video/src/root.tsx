import { Composition } from "remotion";

import { ShowcasePoster, SwitchyShowcase } from "./showcase";
import {
  DARK_SHOWCASE_DURATION,
  LIGHT_SHOWCASE_DURATION,
  SwitchyShowcaseLive,
} from "./showcase-live";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="SwitchyShowcase"
        component={SwitchyShowcase}
        durationInFrames={1320}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="SwitchyShowcasePoster"
        component={ShowcasePoster}
        durationInFrames={1}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="SwitchyShowcaseLight"
        component={SwitchyShowcaseLive}
        defaultProps={{ theme: "light" }}
        durationInFrames={LIGHT_SHOWCASE_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="SwitchyShowcaseDark"
        component={SwitchyShowcaseLive}
        defaultProps={{ theme: "dark" }}
        durationInFrames={DARK_SHOWCASE_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
