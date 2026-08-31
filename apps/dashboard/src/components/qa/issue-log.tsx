"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Pencil, Trash2, Check, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IssueForm } from "@/components/forms/issue-form";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import {
  SEVERITY_TONE,
  label,
  type Severity,
} from "@/lib/constants";
import {
  toggleIssue,
  deleteIssue,
} from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/actions";

type Path = { clientId: string; projectId: string; pageId: string };
type Issue = {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
};

const iconBtn =
  "rounded-md p-1.5 text-text-secondary hover:bg-card-soft hover:text-text-primary";

export function IssueLog({ issues, path }: { issues: Issue[]; path: Path }) {
  const [, startTransition] = React.useTransition();

  const onToggle = (issue: Issue) => {
    startTransition(() => {
      toggleIssue({ id: issue.id, status: issue.status, path });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">
          Issues
          <span className="ml-2 text-sm font-normal text-text-secondary">
            {issues.filter((i) => i.status === "OPEN").length} open
          </span>
        </h2>
        <Dialog
          title="New issue"
          trigger={
            <Button size="sm">
              <Plus /> Add issue
            </Button>
          }
        >
          {(close) => <IssueForm close={close} path={path} />}
        </Dialog>
      </div>

      <Card className="overflow-hidden">
        {issues.length === 0 && (
          <p className="p-5 text-sm text-text-secondary">
            No issues logged. This page is clean.
          </p>
        )}
        <AnimatePresence initial={false}>
          {issues.map((issue) => {
            const fixed = issue.status === "FIXED";
            return (
              <motion.div
                key={issue.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3 border-b border-border-soft px-4 py-3 last:border-0"
              >
                <button
                  type="button"
                  onClick={() => onToggle(issue)}
                  aria-label={fixed ? "Mark open" : "Mark fixed"}
                  className={`flex size-5 items-center justify-center rounded-full border transition-colors ${
                    fixed
                      ? "border-success bg-success text-white"
                      : "border-border-soft text-transparent hover:border-success"
                  }`}
                >
                  {fixed ? <Check className="size-3" /> : <Circle className="size-2" />}
                </button>

                <div className="flex flex-1 flex-col">
                  <span
                    className={`text-sm ${
                      fixed
                        ? "text-text-muted line-through"
                        : "text-text-primary"
                    }`}
                  >
                    {issue.title}
                  </span>
                  {issue.description && (
                    <span className="text-xs text-text-secondary">
                      {issue.description}
                    </span>
                  )}
                </div>

                <Badge tone={SEVERITY_TONE[issue.severity as Severity]}>
                  {label(issue.severity)}
                </Badge>

                <Dialog
                  title="Edit issue"
                  trigger={
                    <button className={iconBtn} aria-label="Edit issue">
                      <Pencil className="size-4" />
                    </button>
                  }
                >
                  {(close) => (
                    <IssueForm close={close} path={path} initial={issue} />
                  )}
                </Dialog>

                <ConfirmDelete
                  action={deleteIssue}
                  fields={{
                    id: issue.id,
                    clientId: path.clientId,
                    projectId: path.projectId,
                    pageId: path.pageId,
                  }}
                  title="Delete issue"
                  description={`Delete "${issue.title}"?`}
                  trigger={
                    <button
                      className="rounded-md p-1.5 text-text-secondary hover:bg-error/10 hover:text-error"
                      aria-label="Delete issue"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  }
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </Card>
    </div>
  );
}
