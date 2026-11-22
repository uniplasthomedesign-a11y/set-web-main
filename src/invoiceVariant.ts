import { useSyncExternalStore } from "react";

// Choix du lecteur pour la version du bon de commande. null = automatique :
// la version « palettes » s'affiche d'office si la commande contient des palettes.
// Partagé entre le bon (InvoicePaper) et ses boutons (InvoiceActions) pour que le PDF
// préparé corresponde toujours à la version affichée.
export type InvoiceVariant = "standard" | "palettes";
let current: InvoiceVariant | null = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setInvoiceVariant(next: InvoiceVariant | null) {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}
export function useInvoiceVariant(): InvoiceVariant | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
