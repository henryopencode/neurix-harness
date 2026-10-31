/** Shared provider display order for the composer and command model pickers. */

/**
 * Sort providers by id without a preferred vendor.
 * @param groups - Provider groups in catalog order.
 * @returns a sorted copy; model order within each group is unchanged.
 */
export function orderModelProviders<T extends { readonly id: string }>(groups: readonly T[]): T[] {
  return groups.toSorted((left, right) => left.id.localeCompare(right.id, 'en'))
}
