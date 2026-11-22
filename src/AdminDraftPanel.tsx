import { useEffect, useState } from "react";
import { Check, HardDrive, RefreshCw } from "lucide-react";
import {
  adminDraftStatus,
  resolveAdminDraftConflict,
  subscribeAdminDraft,
  synchronizeAdminDraft,
} from "./adminDraft";
import { useStore } from "./store";
import { Spinner } from "./ui";
import "./admin-draft.css";

export function AdminDraftPanel() {
  const [status, setStatus] = useState(adminDraftStatus);
  const { refresh, notify } = useStore();
  useEffect(() => subscribeAdminDraft(() => setStatus(adminDraftStatus())), []);
  async function synchronize() {
    try {
      await synchronizeAdminDraft();
      await refresh(true);
      notify("Les modifications ont été synchronisées avec le magasin.");
    } catch (error) {
      notify((error as Error).message, true);
    }
  }
  async function resolve(key: string, keep: boolean) {
    try {
      await resolveAdminDraftConflict(key, keep);
    } catch (error) {
      notify((error as Error).message, true);
    }
  }
  const fieldName = (field: string) =>
    ({
      name: "Nom",
      name_fr: "Nom français",
      code: "Référence",
      barcode: "Code-barres",
      images: "Photos",
      unit_price_cents: "Prix",
      discount_price_cents: "Prix remisé",
      family_id: "Collection",
      available: "Disponibilité",
      visible: "Affichage",
      heroes: "Diaporama",
      videos: "Vidéos",
      phone: "Téléphone",
      weight_grams: "Poids",
    })[field] || field.replaceAll("_", " ");
  return (
    <section
      className="admin-draft-panel"
      aria-label="Sauvegarde sur cet appareil"
    >
      <div className="admin-draft-copy" role="status" aria-live="polite">
        <HardDrive size={21} />
        <div>
          <strong>
            {!status.ready
              ? "Ouverture de la sauvegarde locale…"
              : status.pending
                ? "Modifications enregistrées sur cet appareil"
                : status.refresh_pending
                  ? "Synchronisation enregistrée, actualisation à reprendre"
                  : "Le catalogue est synchronisé"}
          </strong>
          <p>
            Les boutons d’enregistrement des produits, collections et réglages
            sauvegardent ici. Ce bouton publie vos modifications.
          </p>
          {status.pending > 0 && (
            <small>
              {status.pending} élément(s) à synchroniser
              {status.pending_media
                ? ` · ${status.pending_media} fichier(s)`
                : ""}
              .
            </small>
          )}
        </div>
      </div>
      <button
        className="btn btn-primary"
        type="button"
        disabled={
          !status.ready ||
          status.syncing ||
          (!status.pending && !status.refresh_pending) ||
          !!status.conflicts.length
        }
        onClick={() => void synchronize()}
      >
        {status.syncing ? (
          <Spinner />
        ) : status.pending ? (
          <RefreshCw size={18} />
        ) : (
          <Check size={18} />
        )}
        {status.syncing ? "Synchronisation…" : "Enregistrer et synchroniser"}
      </button>
      {status.error && (
        <p className="admin-draft-error" role="alert">
          {status.error}
        </p>
      )}
      {status.error.includes("autre onglet") && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => window.location.reload()}
        >
          Recharger la gestion
        </button>
      )}
      {!!status.conflicts.length && (
        <div className="admin-draft-conflicts">
          {status.conflicts.map((conflict) => (
            <div className="admin-draft-conflict" key={conflict.key}>
              <strong>{conflict.label}</strong>
              <p>
                Modification en ligne :{" "}
                {conflict.fields.map(fieldName).join(", ")}. Les autres
                changements de cet appareil sont conservés.
              </p>
              <div>
                {conflict.can_keep && (
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={() => void resolve(conflict.key, true)}
                  >
                    {conflict.removing
                      ? "Confirmer la suppression de cette nouvelle version"
                      : "Garder ma modification"}
                  </button>
                )}
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => void resolve(conflict.key, false)}
                >
                  {conflict.removing
                    ? "Annuler cette suppression"
                    : "Utiliser la version du site"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
