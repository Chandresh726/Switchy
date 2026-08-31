export const greenhouseNullableMetadataPayload = {
  jobs: [
    {
      id: 101,
      title: "Platform Engineer",
      absolute_url: "https://job-boards.greenhouse.io/acme/jobs/101",
      location: { name: "Bengaluru, India" },
      metadata: null,
    },
    {
      id: 102,
      title: "Backend Engineer",
      absolute_url: "https://job-boards.greenhouse.io/acme/jobs/102",
      location: { name: "Remote" },
      metadata: [{ name: "Remote eligible", value: true }],
    },
  ],
};

export const ashbyNullableOptionalFieldsPayload = {
  jobs: [
    {
      title: "Software Engineer",
      location: null,
      secondaryLocations: null,
      isRemote: null,
      jobUrl: "https://jobs.ashbyhq.com/acme/job-1",
    },
  ],
};

export const mynexthireIsoDatePayload = {
  reqDetailsBOList: [
    {
      reqId: 501,
      reqTitle: "Software Engineer",
      approvedOn: "2026-07-13T13:53:02.091+0000",
    },
  ],
};
