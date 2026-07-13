export function createWorkdayListResponse() {
  return {
    total: 2,
    jobPostings: [
      {
        title: "Platform Engineer",
        externalPath: "/job/REQ-1",
        locationsText: "Bengaluru, India",
        postedOn: "2026-07-01",
        remoteType: "Hybrid",
        bulletFields: [],
      },
      {
        title: "Site Reliability Engineer",
        externalPath: "/job/REQ-2",
        locationsText: "Remote",
        postedOn: "Posted 2 days ago",
        remoteType: "Remote",
        bulletFields: [],
      },
    ],
  };
}
