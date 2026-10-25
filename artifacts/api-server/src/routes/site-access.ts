import { Router, type Request, type Response, type NextFunction } from "express";
import { getSupabaseAdmin } from "../lib/supabase-server";

const router = Router();
const ADMIN_EMAIL = "shashanksv2009@gmail.com";

router.get("/site-auth/config", (_req: Request, res: Response): void => {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabasePublicKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabasePublicKey) {
    res.status(503).json({ error: "Public Supabase URL and anon/publishable key are not configured" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ supabaseUrl, supabasePublicKey });
});

export interface SiteIdentity {
  id: string;
  email: string;
  name: string;
}

export interface SiteAccessRecord {
  user_id: string;
  email: string;
  display_name: string;
  status: "pending" | "approved" | "denied" | "blocked";
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  denial_reason: string | null;
  blocked_until: string | null;
  blocked_reason: string | null;
  status_before_block: "pending" | "approved" | "denied";
}

export async function getSiteIdentity(req: Request): Promise<SiteIdentity | null> {
  const authorization = req.header("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user?.email) return null;
  const metadata = data.user.user_metadata ?? {};
  const name = typeof metadata.full_name === "string"
    ? metadata.full_name
    : typeof metadata.name === "string" ? metadata.name : "";
  return { id: data.user.id, email: data.user.email.toLowerCase(), name };
}

async function ensureAccessRecord(identity: SiteIdentity): Promise<SiteAccessRecord> {
  const admin = getSupabaseAdmin();
  const { data: existing, error: readError } = await admin
    .from("site_access")
    .select("*")
    .eq("user_id", identity.id)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    if (existing.email !== identity.email) {
      const { data, error } = await admin.from("site_access")
        .update({ email: identity.email, display_name: identity.name || existing.display_name })
        .eq("user_id", identity.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as SiteAccessRecord;
    }
    return existing as SiteAccessRecord;
  }

  const { data, error } = await admin.from("site_access")
    .insert({
      user_id: identity.id,
      email: identity.email,
      display_name: identity.name,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as SiteAccessRecord;
}

async function effectiveAccessRecord(identity: SiteIdentity): Promise<SiteAccessRecord> {
  if (identity.email === ADMIN_EMAIL) {
    return {
      user_id: identity.id,
      email: identity.email,
      display_name: "Admin",
      status: "approved",
      requested_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
      denial_reason: null,
      blocked_until: null,
      blocked_reason: null,
      status_before_block: "approved",
    };
  }

  const record = await ensureAccessRecord(identity);
  if (record.status === "blocked" && record.blocked_until && Date.parse(record.blocked_until) <= Date.now()) {
    const { data, error } = await getSupabaseAdmin().from("site_access")
      .update({
        status: record.status_before_block,
        blocked_until: null,
        blocked_reason: null,
      })
      .eq("user_id", identity.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as SiteAccessRecord;
  }
  return record;
}

export async function requireApprovedSiteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const identity = await getSiteIdentity(req);
    if (!identity) {
      res.status(401).json({ error: "Sign in with Google to access learning content", code: "SITE_LOGIN_REQUIRED" });
      return;
    }
    const access = await effectiveAccessRecord(identity);
    if (access.status !== "approved") {
      res.status(403).json({
        error: access.status === "blocked" ? access.blocked_reason ?? "Your account is blocked" : "Learning access is not approved",
        code: access.status === "blocked" ? "SITE_ACCESS_BLOCKED" : `SITE_ACCESS_${access.status.toUpperCase()}`,
        status: access.status,
        reason: access.status === "denied" ? access.denial_reason : access.blocked_reason,
        blockedUntil: access.blocked_until,
      });
      return;
    }
    next();
  } catch (error) {
    res.status(503).json({ error: "Access status could not be checked", code: "SITE_ACCESS_UNAVAILABLE" });
  }
}

async function requireAdmin(req: Request, res: Response): Promise<SiteIdentity | null> {
  try {
    const identity = await getSiteIdentity(req);
    if (!identity || identity.email !== ADMIN_EMAIL) {
      res.status(403).json({ error: "Admin access is restricted" });
      return null;
    }
    return identity;
  } catch {
    res.status(503).json({ error: "Admin access could not be verified" });
    return null;
  }
}

router.get("/site-access/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const identity = await getSiteIdentity(req);
    if (!identity) {
      res.status(401).json({ error: "Sign in with Google first" });
      return;
    }
    const access = await effectiveAccessRecord(identity);
    res.json({
      userId: access.user_id,
      email: access.email,
      displayName: access.display_name,
      status: access.status,
      requestedAt: access.requested_at,
      denialReason: access.denial_reason,
      blockedUntil: access.blocked_until,
      blockedReason: access.blocked_reason,
      isAdmin: identity.email === ADMIN_EMAIL,
    });
  } catch {
    res.status(503).json({ error: "Access request could not be created or loaded" });
  }
});

router.get("/admin/site-access", async (req: Request, res: Response): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  if (!["all", "pending", "approved", "denied", "blocked"].includes(status)) {
    res.status(400).json({ error: "Invalid access status" });
    return;
  }
  try {
    let query = getSupabaseAdmin().from("site_access").select("*").order("requested_at", { ascending: false });
    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ users: (data ?? []).map((user) => ({
      userId: user.user_id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
      requestedAt: user.requested_at,
      reviewedAt: user.reviewed_at,
      reviewedBy: user.reviewed_by,
      denialReason: user.denial_reason,
      blockedUntil: user.blocked_until,
      blockedReason: user.blocked_reason,
      statusBeforeBlock: user.status_before_block,
    })) });
  } catch {
    res.status(500).json({ error: "Could not load site access requests" });
  }
});

router.post("/admin/site-access/:userId/decision", async (req: Request, res: Response): Promise<void> => {
  const identity = await requireAdmin(req, res);
  if (!identity) return;
  const status = req.body?.status;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  if (status !== "approved" && status !== "denied") {
    res.status(400).json({ error: "Decision must be approved or denied" });
    return;
  }
  try {
    const { data, error } = await getSupabaseAdmin().from("site_access")
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: identity.email,
        denial_reason: status === "denied" ? reason || null : null,
        blocked_until: null,
        blocked_reason: null,
      })
      .eq("user_id", req.params.userId)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ user: data });
  } catch {
    res.status(500).json({ error: "Could not update the access request" });
  }
});

router.post("/admin/site-access/:userId/block", async (req: Request, res: Response): Promise<void> => {
  const identity = await requireAdmin(req, res);
  if (!identity) return;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  const durationHours = req.body?.durationHours;
  if (!reason || (durationHours !== null && (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 8760))) {
    res.status(400).json({ error: "Provide a reason and a valid duration in hours, or null for a permanent block" });
    return;
  }
  try {
    const admin = getSupabaseAdmin();
    const { data: current, error: readError } = await admin.from("site_access")
      .select("status,status_before_block,email")
      .eq("user_id", req.params.userId)
      .single();
    if (readError) throw readError;
    if (current.email?.toLowerCase() === ADMIN_EMAIL) {
      res.status(400).json({ error: "The site administrator cannot be blocked here" });
      return;
    }
    const blockedUntil = durationHours === null ? null : new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin.from("site_access")
      .update({
        status: "blocked",
        status_before_block: current.status === "blocked" ? current.status_before_block : current.status,
        blocked_until: blockedUntil,
        blocked_reason: reason,
      })
      .eq("user_id", req.params.userId)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ user: data });
  } catch {
    res.status(500).json({ error: "Could not block this user" });
  }
});

router.post("/admin/site-access/:userId/unblock", async (req: Request, res: Response): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  try {
    const admin = getSupabaseAdmin();
    const { data: current, error: readError } = await admin.from("site_access")
      .select("status,status_before_block")
      .eq("user_id", req.params.userId)
      .single();
    if (readError) throw readError;
    if (current.status !== "blocked") {
      res.status(400).json({ error: "This user is not blocked" });
      return;
    }
    const { data, error } = await admin.from("site_access")
      .update({ status: current.status_before_block, blocked_until: null, blocked_reason: null })
      .eq("user_id", req.params.userId)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ user: data });
  } catch {
    res.status(500).json({ error: "Could not unblock this user" });
  }
});

export default router;