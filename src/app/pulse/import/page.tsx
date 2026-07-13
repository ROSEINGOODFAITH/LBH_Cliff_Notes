import { desc } from "drizzle-orm";
import { requireTeamMember } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { db } from "@/db";
import { importBatches } from "@/db/schema";
import { ImportWorkflow, type BatchSummary } from "./import-workflow";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const team = await requireTeamMember();

  const batches = await db
    .select()
    .from(importBatches)
    .orderBy(desc(importBatches.createdAt))
    .limit(20);

  const history: BatchSummary[] = batches.map((b) => ({
    id: b.id,
    filename: b.filename,
    operator: b.operator,
    createdAt: b.createdAt.toISOString(),
    totalRows: b.totalRows,
    enriched: b.enrichedCount,
    created: b.createdCount,
    skipped: b.skippedCount,
    conflict: b.conflictCount,
    error: b.errorCount,
    unchanged: b.unchangedCount,
  }));

  return (
    <div className="min-h-screen">
      <AppNav active="/pulse/import" email={team.email} />
      <ImportWorkflow history={history} operator={team.email} />
    </div>
  );
}
