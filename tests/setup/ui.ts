import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { resetTestDoubles } from "./base";

afterEach(() => {
  cleanup();
  resetTestDoubles();
});
