import { route } from "@/lib/http";
import { DEFAULT_TASK, runAgentProposal } from "@/lib/proposalService";

/**
 * Guided walkthrough: one click runs the purchasing agent on a general
 * "check stock and reorder" request. Rate-limited more strictly than the
 * composer because it is the public button judges press first.
 */
export const POST = route(async (req: Request) => runAgentProposal(req, DEFAULT_TASK, "walkthrough"));
