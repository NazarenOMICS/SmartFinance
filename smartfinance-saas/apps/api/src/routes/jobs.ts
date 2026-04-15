import { Hono } from "hono";
import { getCategorizationJob } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const jobsRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

jobsRouter.get("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const jobId = String(c.req.param("id") || "").trim();
  if (!jobId) {
    return jsonError("Invalid job id", "VALIDATION_ERROR", requestId, 400);
  }

  const job = await getCategorizationJob(c.env.DB, auth.userId, jobId);
  if (!job) {
    return jsonError("Job not found", "JOB_NOT_FOUND", requestId, 404);
  }

  return c.json({
    ...job,
    result: JSON.parse(String(job.result_json || "{}")),
  });
});

export default jobsRouter;
