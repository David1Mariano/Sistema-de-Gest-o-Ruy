import { canAccess, ANEXOS_ID_RE } from '../production/anexos.mjs';

/** Reuses the local disk store; no download, migration or deletion. */
export function createFinanceAttachmentAuthorizer(store) {
  return async ({ actor, entity, recordId, field, value }) => {
    const id = value.slice('ruy-anexo://'.length);
    if (!ANEXOS_ID_RE.test(id)) return false;
    const meta = await store.getMeta(id);
    if (!meta || meta.entity !== entity || meta.record_id !== recordId || meta.field !== field || !canAccess(meta, actor)) return false;
    // readContent also verifies persisted SHA-256 and availability.
    await store.readContent(meta);
    return true;
  };
}
