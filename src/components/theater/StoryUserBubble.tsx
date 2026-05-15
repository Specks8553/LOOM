import { useState } from 'react';

import { InputArea } from '@/components/theater/InputArea';
import { useCachedMessageGuard } from '@/hooks/useCachedMessageGuard';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { ChatMessage, UserContent } from '@/lib/types';

interface StoryUserBubbleProps {
  message: ChatMessage;
}

/**
 * Doc 27 §Story user bubble + Doc 15 §Editing a Message.
 *
 * Renders a `json_user` row as a labelled four-field stack. Empty fields are
 * omitted. Right-side hover affordances: Edit / Delete exchange / Delete
 * from here. Edit pops the InputArea in place; commit triggers
 * `edit_user_message` (truncate-and-replace + regenerate).
 */
export function StoryUserBubble({ message }: StoryUserBubbleProps) {
  const [editing, setEditing] = useState(false);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const editUser = useWorkspaceStore((s) => s.editUser);
  const deleteExchange = useWorkspaceStore((s) => s.deleteExchange);
  const deleteFrom = useWorkspaceStore((s) => s.deleteFrom);
  const { modal: cachedGuardModal, guard: guardCachedMessage } = useCachedMessageGuard();

  const parsed = safeParse(message.content);

  async function handleEditClick() {
    const proceed = await guardCachedMessage(message, 'edit');
    if (!proceed) return;
    setEditing(true);
  }

  async function handleEditCommit(content: UserContent) {
    setEditing(false);
    await editUser(message.id, content);
  }

  async function handleDelete(scope: 'exchange' | 'from') {
    const proceed = await guardCachedMessage(message, 'delete');
    if (!proceed) return;
    const label = scope === 'exchange' ? 'this exchange' : 'this and every exchange after';
    if (!window.confirm(`Delete ${label}?\nThis cannot be undone in v2.0.`)) return;
    if (scope === 'exchange') {
      await deleteExchange(message.id);
    } else {
      await deleteFrom(message.id);
    }
  }

  if (editing) {
    return (
      <div className="mx-auto w-full max-w-[80%] py-2">
        <InputArea
          initial={parsed}
          onCommit={(c) => void handleEditCommit(c)}
          onCancel={() => setEditing(false)}
          submitLabel="Save & regenerate"
        />
      </div>
    );
  }

  return (
    <div className="group relative mx-auto w-full max-w-[80%] py-2">
      <div className="rounded-md border border-[--color-border] bg-[--color-bg-soft] p-3 text-[14px] text-[--color-text-primary]">
        {parsed.plot_direction.trim().length > 0 && (
          <Section label="PLOT DIRECTION">{parsed.plot_direction}</Section>
        )}
        {parsed.background_information.trim().length > 0 && (
          <Section label="BACKGROUND INFORMATION — NOT FOR THE READER" dim>
            {parsed.background_information}
          </Section>
        )}
        {parsed.modificators.length > 0 && (
          <div className="mt-2">
            <Label>MODIFICATORS</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {parsed.modificators.map((m, i) => (
                <span
                  key={`${m}-${i}`}
                  className="rounded-sm border border-[--color-border] bg-[--color-bg] px-1.5 py-0.5 text-[12px] text-[--color-text-secondary]"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}
        {parsed.constraints.trim().length > 0 && (
          <Section label="CONSTRAINTS — DO NOT INCLUDE IN OUTPUT" dim>
            {parsed.constraints}
          </Section>
        )}
      </div>
      <ActionRow
        disabled={isGenerating}
        onEdit={() => void handleEditClick()}
        onDeleteExchange={() => void handleDelete('exchange')}
        onDeleteFrom={() => void handleDelete('from')}
      />
      {cachedGuardModal}
    </div>
  );
}

function safeParse(json: string): UserContent {
  try {
    const obj = JSON.parse(json) as Partial<UserContent>;
    return {
      plot_direction: typeof obj.plot_direction === 'string' ? obj.plot_direction : '',
      background_information:
        typeof obj.background_information === 'string' ? obj.background_information : '',
      modificators: Array.isArray(obj.modificators)
        ? obj.modificators.filter((m): m is string => typeof m === 'string')
        : [],
      constraints: typeof obj.constraints === 'string' ? obj.constraints : '',
    };
  } catch {
    return { plot_direction: '', background_information: '', modificators: [], constraints: '' };
  }
}

function Section({ label, dim, children }: { label: string; dim?: boolean; children: string }) {
  return (
    <div className="mt-2 first:mt-0">
      <Label>{label}</Label>
      <p
        className={`mt-1 whitespace-pre-wrap text-[14px] ${
          dim ? 'text-[--color-text-muted]' : 'text-[--color-text-primary]'
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wider text-[--color-text-muted]">
      {children}
    </span>
  );
}

interface ActionRowProps {
  disabled: boolean;
  onEdit: () => void;
  onDeleteExchange: () => void;
  onDeleteFrom: () => void;
}

function ActionRow({ disabled, onEdit, onDeleteExchange, onDeleteFrom }: ActionRowProps) {
  return (
    <div className="pointer-events-none absolute -top-1 right-0 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
      <ActionButton onClick={onEdit} disabled={disabled}>
        Edit
      </ActionButton>
      <ActionButton onClick={onDeleteExchange} disabled={disabled}>
        Delete
      </ActionButton>
      <ActionButton onClick={onDeleteFrom} disabled={disabled}>
        Delete from here
      </ActionButton>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-sm border border-[--color-border] bg-[--color-bg] px-2 py-0.5 text-[11px] text-[--color-text-muted] hover:text-[--color-text-primary] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
