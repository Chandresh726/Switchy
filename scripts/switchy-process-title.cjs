"use strict";

const requestedTitle = process.env.SWITCHY_PROCESS_TITLE?.trim();
const entrypoint = process.argv[1] ?? "";
const command = process.argv[2];
const isNextCli = /[\\/]next[\\/]dist[\\/]bin[\\/]next$/u.test(entrypoint);
const isNextDevServer = process.env.NEXT_PRIVATE_WORKER === "1"
  && process.env.__NEXT_DEV_SERVER === "1";
const shouldBrand = requestedTitle
  && (isNextDevServer || (isNextCli && ["dev", "start"].includes(command)));

if (shouldBrand) {
  process.title = requestedTitle;

  if (isNextDevServer || command === "start") {
    let checks = 0;
    const titleCheck = setInterval(() => {
      checks += 1;
      if (process.title.startsWith("next-server")) {
        process.title = requestedTitle;
        clearInterval(titleCheck);
      } else if (checks >= 1_200) {
        clearInterval(titleCheck);
      }
    }, 25);
    titleCheck.unref();
  }
}
