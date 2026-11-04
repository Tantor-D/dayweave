import { z } from 'zod';
import { validDate } from '../domain/operations.ts';
import type { Store } from './store.ts';

const date = z.string().refine(validDate, '日期无效');
export const documentQuerySchema = z
  .strictObject({
    query: z.string().trim().min(1).max(200).optional(),
    kind: z.enum(['daily', 'notes']).optional(),
    startDate: date.optional(),
    endDate: date.optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .refine(
    (input) => !input.startDate || !input.endDate || input.startDate <= input.endDate,
    '开始日期不能晚于结束日期',
  )
  .refine(
    (input) => input.kind !== 'notes' || (!input.startDate && !input.endDate),
    '独立反思不支持日期筛选',
  );

export async function queryDocuments(
  store: Pick<Store, 'listDocuments' | 'read'>,
  input: z.infer<typeof documentQuerySchema>,
) {
  const matches: { target: string; title: string; snippet?: string }[] = [];
  const unavailable: string[] = [];
  const needle = input.query?.toLowerCase();
  for (const doc of await store.listDocuments()) {
    const [kind, day] = doc.target.split('/');
    if (input.kind && input.kind !== kind) continue;
    if (
      (input.startDate || input.endDate) &&
      (kind !== 'daily' ||
        (input.startDate && day < input.startDate) ||
        (input.endDate && day > input.endDate))
    )
      continue;
    const snapshot = await store.read(doc.target);
    // Never search an unaccepted external version or a damaged document.
    if (snapshot.external || snapshot.readOnly) {
      unavailable.push(doc.target);
      continue;
    }
    const content = String(snapshot.data);
    const index = needle ? content.toLowerCase().indexOf(needle) : -1;
    if (needle && index === -1) continue;
    const start = Math.max(0, index - 60);
    matches.push({
      ...doc,
      ...(needle
        ? {
            snippet: `${start ? '…' : ''}${content.slice(start, start + 240)}${content.length > start + 240 ? '…' : ''}`,
          }
        : {}),
    });
  }
  const items = matches.slice(input.offset, input.offset + input.limit);
  return {
    items,
    total: matches.length,
    offset: input.offset,
    limit: input.limit,
    nextOffset: input.offset + input.limit < matches.length ? input.offset + input.limit : null,
    unavailableCount: unavailable.length,
  };
}
