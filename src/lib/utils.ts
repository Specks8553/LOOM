import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** clsx + tailwind-merge — Doc 24 §`cn()` for Conditional Classes. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
