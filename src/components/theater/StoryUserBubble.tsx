import { useState } from 'react';

import { BubbleActionRow } from '@/components/theater/BubbleActions';
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
 * omitted. Below-bubble hover action row: Edit / Delete / Delete from here.
 * Edit pops the InputArea in place; commit triggers `edit_user_message`
 * (truncate-and-replace + regenerate).
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
    <div className="group ml-auto flex w-fit max-w-[65%] flex-col items-end py-2">
      <div className="rounded-bubble border bg-[--bubble-user-bg] px-4 py-3 [border-color:color-mix(in_srgb,var(--color-accent)_12%,transparent)]">
        {parsed.plot_direction.trim().length > 0 && (
          <Field label="Plot Direction">
            <p className="whitespace-pre-wrap text-[13px] leading-normal text-[--color-text-primary]">
              {parsed.plot_direction}
            </p>
          </Field>
        )}
        {parsed.background_information.trim().length > 0 && (
          <Field label="Background" dim>
            <p className="whitespace-pre-wrap text-[12px] leading-normal text-[--color-text-secondary]">
              {parsed.background_information}
            </p>
          </Field>
        )}
        {parsed.modificators.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {parsed.modificators.map((m, i) => (
              <span
                key={`${m}-${i}`}
                className="rounded-sm bg-[--color-accent-subtle] px-2 py-0.5 text-[10px] text-[--color-accent-text]"
              >
                {m}
              </span>
            ))}
          </div>
        )}
        {parsed.constraints.trim().length > 0 && (
          <Field label="Constraints" dim>
            <p className="whitespace-pre-wrap text-[12px] italic leading-snug text-[--color-text-muted]">
              {parsed.constraints}
            </p>
          </Field>
        )}
      </div>
      <BubbleActionRow
        align="right"
        actions={[
          {
            icon: '✎',
            label: 'Edit',
            disabled: isGenerating,
            onClick: () => void handleEditClick(),
          },
          {
            icon: '×',
            label: 'Delete',
            destructive: true,
            disabled: isGenerating,
            onClick: () => void handleDelete('exchange'),
          },
          {
            icon: '×',
            label: 'Delete from here',
            destructive: true,
            disabled: isGenerating,
            onClick: () => void handleDelete('from'),
          },
        ]}
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

/** A labelled section inside the bubble. `dim` fades the label (Doc 27). */
function Field({
  label,
  dim,
  children,
}: {
  label: string;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2.5 first:mt-0">
      <span
        className={`text-[9px] font-medium uppercase tracking-[0.08em] text-[--color-text-muted] ${
          dim ? 'opacity-70' : ''
        }`}
      >
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </div>
  );
}
