import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadResume } from "@/lib/api/clients/profile";

describe("resume download client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads the blob using a safe filename and revokes its object URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("resume", {
          headers: {
            "content-disposition": "attachment; filename=\"../candidate.pdf\"",
          },
        })
      )
    );
    const createObjectURL = vi.fn().mockReturnValue("blob:switchy-resume");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadResume(12);

    expect(fetch).toHaveBeenCalledWith(
      "/api/profile/resumes/12/download",
      { method: "GET" }
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:switchy-resume");
  });

  it("does not create a file when the server returns a JSON error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: "Resume file is missing",
            code: "not_found",
            requestId: "req-resume",
          },
          { status: 404 }
        )
      )
    );
    const createObjectURL = vi.fn();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    await expect(downloadResume(12)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      requestId: "req-resume",
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
