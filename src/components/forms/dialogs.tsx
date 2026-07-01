"use client";

import { Plus, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ClientForm } from "@/components/forms/client-form";
import { ProjectForm } from "@/components/forms/project-form";
import { PageForm } from "@/components/forms/page-form";
import { MemberForm } from "@/components/forms/member-form";

const iconBtn =
  "rounded-md p-1.5 text-text-secondary hover:bg-card-soft hover:text-text-primary";

type Member = { id: string; name: string; role: string };

export function AddMemberButton() {
  return (
    <Dialog
      title="New team member"
      trigger={
        <Button>
          <Plus /> New member
        </Button>
      }
    >
      {(close) => <MemberForm close={close} />}
    </Dialog>
  );
}

export function EditMemberButton({
  member,
}: {
  member: { id: string; name: string; role: string };
}) {
  return (
    <Dialog
      title="Edit team member"
      trigger={
        <button className={iconBtn} aria-label="Edit member">
          <Pencil className="size-4" />
        </button>
      }
    >
      {(close) => <MemberForm close={close} initial={member} />}
    </Dialog>
  );
}

export function AddClientButton() {
  return (
    <Dialog
      title="New client"
      trigger={
        <Button>
          <Plus /> New client
        </Button>
      }
    >
      {(close) => <ClientForm close={close} />}
    </Dialog>
  );
}

export function EditClientButton({
  client,
}: {
  client: { id: string; name: string; notes: string | null };
}) {
  return (
    <Dialog
      title="Edit client"
      trigger={
        <button className={iconBtn} aria-label="Edit client">
          <Pencil className="size-4" />
        </button>
      }
    >
      {(close) => <ClientForm close={close} initial={client} />}
    </Dialog>
  );
}

export function AddProjectButton({
  clientId,
  members = [],
}: {
  clientId: string;
  members?: Member[];
}) {
  return (
    <Dialog
      title="New project"
      trigger={
        <Button>
          <Plus /> New project
        </Button>
      }
    >
      {(close) => (
        <ProjectForm close={close} clientId={clientId} members={members} />
      )}
    </Dialog>
  );
}

export function EditProjectButton({
  clientId,
  project,
  members = [],
}: {
  clientId: string;
  members?: Member[];
  project: {
    id: string;
    name: string;
    type: string;
    platform: string;
    url: string | null;
    status: string;
    developerId?: string | null;
    testerId?: string | null;
    deliveryMonth?: string | null;
  };
}) {
  return (
    <Dialog
      title="Edit project"
      trigger={
        <button className={iconBtn} aria-label="Edit project">
          <Pencil className="size-4" />
        </button>
      }
    >
      {(close) => (
        <ProjectForm
          close={close}
          clientId={clientId}
          members={members}
          initial={project}
        />
      )}
    </Dialog>
  );
}

export function AddPageButton({
  clientId,
  projectId,
  members,
}: {
  clientId: string;
  projectId: string;
  members: Member[];
}) {
  return (
    <Dialog
      title="New page"
      trigger={
        <Button>
          <Plus /> New page
        </Button>
      }
    >
      {(close) => (
        <PageForm
          close={close}
          clientId={clientId}
          projectId={projectId}
          members={members}
        />
      )}
    </Dialog>
  );
}

export function EditPageButton({
  clientId,
  projectId,
  members,
  page,
}: {
  clientId: string;
  projectId: string;
  members: Member[];
  page: {
    id: string;
    name: string;
    url: string | null;
    status: string;
    developerId: string | null;
    testerId: string | null;
    delayDays: number;
    deliveryMonth: string | null;
  };
}) {
  return (
    <Dialog
      title="Edit page"
      trigger={
        <button className={iconBtn} aria-label="Edit page">
          <Pencil className="size-4" />
        </button>
      }
    >
      {(close) => (
        <PageForm
          close={close}
          clientId={clientId}
          projectId={projectId}
          members={members}
          initial={page}
        />
      )}
    </Dialog>
  );
}
