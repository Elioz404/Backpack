import { AgentMail } from "@agentmail/convex";
import { components, internal } from "../_generated/api";

/**
 * The household inbox.
 *
 * `onMessageReceived` is what makes the board react to mail: the component
 * verifies and stores the inbound message, then hands it to our pipeline,
 * which decides whether it is an answer to a question we asked or a new
 * source to read.
 */
/**
 * The type annotation is required, not stylistic: the callback reference makes
 * this value depend on the generated `internal` API, which in turn describes
 * the module that defines the callback. Naming the type breaks that inference
 * cycle (TS7022).
 */
export const agentmail: AgentMail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.pipelines.mailIngest.onMessageReceived,
});
