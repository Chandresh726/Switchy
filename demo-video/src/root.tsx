import { Composition } from "remotion";

import { ShowcasePoster, SwitchyShowcase } from "./showcase";
import {
  SHOWCASE_DURATION,
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
        id="SwitchyShowcaseLive"
        component={SwitchyShowcaseLive}
        durationInFrames={SHOWCASE_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
