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

export const nutanixSourceFeed = `<?xml version="1.0" encoding="utf-8"?>
  <source>
    <publisher>Nutanix</publisher>
    <job>
      <title>Staff Engineer</title>
      <date>2026-07-01T00:00:00.000Z</date>
      <apijobid>source-123</apijobid>
      <url>https://careers.nutanix.com/jobs/source-123</url>
      <city>Bengaluru</city>
      <state>Karnataka</state>
      <country>India</country>
    </job>
  </source>`;
