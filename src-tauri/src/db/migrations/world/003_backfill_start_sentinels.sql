-- D-24 follow-up: backfill the start-sentinel checkpoint for every Story that
-- lacks one.
--
-- New stories receive a start sentinel in services/vault.rs::create_item
-- (Doc 16 §Story creation). Stories created before that logic was wired have no
-- sentinel row, so their "Chapter 1" banner never renders (TheaterBody builds
-- one banner per checkpoint) and the accordion split algorithm can't find a
-- "previous checkpoint" when the writer inserts the first chapter. This heals
-- existing worlds.
--
-- Idempotent via the NOT EXISTS guard: running on a world whose stories already
-- have sentinels inserts nothing. The generated id is a v4-shaped UUID to match
-- the runtime `Uuid::new_v4()` ids; `(random() & 3)` avoids the abs-overflow
-- edge case of the more common `abs(random()) % 4` snippet.

INSERT INTO checkpoints (id, story_id, after_message_id, name, is_start, created_at, modified_at)
SELECT
    lower(
        hex(randomblob(4)) || '-' ||
        hex(randomblob(2)) || '-4' ||
        substr(hex(randomblob(2)), 2) || '-' ||
        substr('89ab', (random() & 3) + 1, 1) ||
        substr(hex(randomblob(2)), 2) || '-' ||
        hex(randomblob(6))
    ),
    i.id,
    NULL,
    'Chapter 1',
    1,
    i.created_at,
    i.created_at
FROM items i
WHERE i.item_type = 'Story'
  AND NOT EXISTS (
      SELECT 1 FROM checkpoints c
      WHERE c.story_id = i.id AND c.is_start = 1
  );
