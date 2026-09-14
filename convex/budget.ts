import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUserId } from "./model/auth";
import * as Budget from "./model/budget";

/**
 * What the deployment has spent at OpenAI.
 *
 * Shown in the app because the person running Backpack is paying for it on
 * their own key, and a number they have to go to a dashboard to find is a
 * number they will discover too late.
 *
 * Deployment-wide rather than per household: it is one API key and one bill.
 * Gated on being signed in, but not on a household — there is nothing here
 * that belongs to one.
 */
export const current = query({
  args: {},
  returns: v.object({
    spentCents: v.number(),
    budgetCents: v.number(),
    calls: v.number(),
    exhausted: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await Budget.read(ctx);
  },
});
