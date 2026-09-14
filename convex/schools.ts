import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_CRAWL_LIMIT } from "./lib/config";
import { DEFAULT_EXCLUDE_PATHS } from "./lib/firecrawl";
import { requireMembership } from "./model/households";
import { schoolsOf } from "./model/households";

/**
 * The sites a household watches.
 *
 * A school is the unit a crawl is pointed at, and it carries its own crawl
 * shape — breadth and path filters — because a small primary school and a
 * district portal are not the same size of problem.
 */

export const list = query({
  args: { householdId: v.id("households") },
  returns: v.array(
    v.object({
      _id: v.id("schools"),
      name: v.string(),
      siteUrl: v.string(),
      officeEmail: v.union(v.string(), v.null()),
      crawlLimit: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);
    const schools = await schoolsOf(ctx, args.householdId);
    return schools.map((school) => ({
      _id: school._id,
      name: school.name,
      siteUrl: school.siteUrl,
      officeEmail: school.officeEmail ?? null,
      crawlLimit: school.crawlLimit,
    }));
  },
});

/**
 * Reject anything that is not a public web page before it reaches Firecrawl.
 *
 * A crawl is a spend and a request made on the family's behalf, so the target
 * is validated here rather than being discovered as an error later.
 */
function parseSiteUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ConvexError({ code: "INVALID", field: "siteUrl" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConvexError({ code: "INVALID", field: "siteUrl" });
  }
  return parsed.toString();
}

export const add = mutation({
  args: {
    householdId: v.id("households"),
    name: v.string(),
    siteUrl: v.string(),
    officeEmail: v.optional(v.string()),
  },
  returns: v.id("schools"),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const name = args.name.trim();
    if (name === "") {
      throw new ConvexError({ code: "INVALID", field: "name" });
    }

    return await ctx.db.insert("schools", {
      householdId: args.householdId,
      name,
      siteUrl: parseSiteUrl(args.siteUrl),
      officeEmail: args.officeEmail?.trim() || undefined,
      crawlLimit: DEFAULT_CRAWL_LIMIT,
      excludePaths: [...DEFAULT_EXCLUDE_PATHS],
    });
  },
});

export const update = mutation({
  args: {
    householdId: v.id("households"),
    schoolId: v.id("schools"),
    name: v.optional(v.string()),
    siteUrl: v.optional(v.string()),
    officeEmail: v.optional(v.string()),
    crawlLimit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.householdId);

    const school = await ctx.db.get(args.schoolId);
    if (school === null || school.householdId !== args.householdId) {
      throw new ConvexError({ code: "NOT_FOUND", entity: "school" });
    }

    // A limit of zero would make a crawl a no-op and a huge one would empty
    // the family's Firecrawl allowance in a single run.
    if (
      args.crawlLimit !== undefined &&
      (args.crawlLimit < 1 || args.crawlLimit > 200)
    ) {
      throw new ConvexError({ code: "INVALID", field: "crawlLimit" });
    }

    await ctx.db.patch(args.schoolId, {
      name: args.name?.trim() || school.name,
      siteUrl:
        args.siteUrl === undefined ? school.siteUrl : parseSiteUrl(args.siteUrl),
      officeEmail: args.officeEmail?.trim() || school.officeEmail,
      crawlLimit: args.crawlLimit ?? school.crawlLimit,
    });
    return null;
  },
});
