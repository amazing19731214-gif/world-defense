// Existing feature tests explicitly supply the new entry resources; production has no bypass.
export async function installJobBookTestFixtures(context) {
  await context.addInitScript(() => {
    window.seedJobEntry = (s, jobs = Object.keys(WD_DEBUG.jobBookApi.ADVANCED_JOB_REQ)) => {
      const D = WD_DEBUG,
        F = D.forgeApi.save();
      for (const j of jobs) {
        F.jobBooks[j] = 100;
        const req = D.jobBookApi.ADVANCED_JOB_REQ[j] || D.insightApi.EVOLUTION_JOBS[j]?.req || [];
        for (const [id, n] of req) s.prof[id] = Math.max(s.prof[id] || 0, D.jobApi.profNeed(id, n));
      }
    };
  });
}
