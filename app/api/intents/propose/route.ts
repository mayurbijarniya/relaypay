import { readJson, route } from "@/lib/http";
import { DEFAULT_TASK, runAgentProposal } from "@/lib/proposalService";

export const POST = route(async (req: Request) => {
  const body = await readJson(req);
  const task = typeof body.task === "string" && body.task.trim() ? body.task.trim().slice(0, 500) : DEFAULT_TASK;
  return runAgentProposal(req, task, "agent");
});
