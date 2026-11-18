"use client";

import { useActionState, useState } from "react";
import { alertError, alertSuccess, btnPrimary, btnSecondary, hint, input, label } from "@/components/ui";
import type { SettingsFormState } from "./form-state";

type Action = (previous: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;

export type BrandingValues = {
  displayName: string;
  advisorName: string;
  contactPhone: string;
  advisorEmail: string;
  defaultLanguage: string;
  brandColor: string;
  defaultMessage: string;
};

// Preset colors of the mockup, plus "Custom".
const COLORS = ["#1f4d3d", "#21436b", "#6b2f4a", "#7a4b12", "#2f2f2f"];
const DEFAULT_COLOR = "#1f4d3d";

function Message({ state }: { state: SettingsFormState }) {
  if (!state) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
      {state.message}
    </p>
  );
}

// "Client quote branding": what clients see on the quote link. Apolles is never shown to them.
// The preview on the side shows the agency as the client page will.
export function BrandingForm({
  action,
  values,
  fallback,
}: {
  action: Action;
  values: BrandingValues;
  fallback: { name: string; advisor: string; phone: string };
}) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(action, null);
  const shown = state?.status === "error" && state.values ? { ...values, ...state.values } : values;
  const [name, setName] = useState(shown.displayName);
  const [advisor, setAdvisor] = useState(shown.advisorName);
  const [color, setColor] = useState(shown.brandColor);
  const shownColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLOR;

  return (
    <form key={JSON.stringify(shown)} action={formAction} className="grid gap-6 lg:grid-cols-[1fr_320px]" noValidate>
      <div className="flex flex-col gap-4">
        <Message state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Display name
            <input name="displayName" maxLength={80} defaultValue={shown.displayName} placeholder={fallback.name} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          <label className={label}>
            Advisor name
            <input name="advisorName" maxLength={80} defaultValue={shown.advisorName} placeholder={fallback.advisor} onChange={(e) => setAdvisor(e.target.value)} className={input} />
          </label>
          <label className={label}>
            Contact number
            <input type="tel" name="contactPhone" maxLength={30} defaultValue={shown.contactPhone} placeholder={fallback.phone || "+972 50 123 4567"} className={input} />
            <span className={hint}>Used for the WhatsApp and Call buttons on the quote.</span>
          </label>
          <label className={label}>
            Advisor email
            <input type="email" name="advisorEmail" maxLength={254} defaultValue={shown.advisorEmail} className={input} />
            <span className={hint}>Client replies to the quote email go here.</span>
          </label>
          <label className={label}>
            Default quote language
            <select name="defaultLanguage" defaultValue={shown.defaultLanguage} className={input}>
              <option value="EN">English</option>
              <option value="HE">Hebrew (right to left)</option>
            </select>
            <span className={hint}>You can change the language on each quote.</span>
          </label>
          <fieldset className={label}>
            <legend className="mb-1.5">Brand color</legend>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={shownColor === c}
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 ${shownColor === c ? "border-ink" : "border-white"} shadow`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input name="brandColor" value={color} onChange={(e) => setColor(e.target.value)} maxLength={7} placeholder="Custom #1f4d3d" aria-label="Custom color" className={`${input} w-36`} />
            </div>
            <span className={hint}>One color for the quote header and buttons.</span>
          </fieldset>
        </div>
        <label className={label}>
          Default message to clients
          <textarea name="defaultMessage" rows={3} maxLength={1000} defaultValue={shown.defaultMessage} className={input} />
          <span className={hint}>Put into each new quote. You can change it on each quote.</span>
        </label>
        <button type="submit" disabled={pending} className={`${btnPrimary} self-start`}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
      <aside aria-label="Preview" className="h-fit overflow-hidden rounded-[18px] border border-line bg-white">
        <div className="flex items-center gap-3 p-4 text-white" style={{ backgroundColor: shownColor }}>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white/20 text-sm font-bold">{(name || fallback.name).slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0">
            <strong className="block truncate">{name || fallback.name}</strong>
            <span className="block truncate text-xs text-white/80">{advisor || fallback.advisor} · Travel advisor</span>
          </span>
        </div>
        <div className="p-4">
          <p className="text-xs text-muted">Your travel proposal</p>
          <p className="font-serif text-xl text-ink">Mexico Honeymoon</p>
          <span className="mt-3 inline-block rounded-[10px] px-3 py-2 text-xs font-bold text-white" style={{ backgroundColor: shownColor }}>
            WhatsApp
          </span>
          <p className="mt-3 text-xs text-muted">This is how your agency appears on the client quote page.</p>
        </div>
      </aside>
    </form>
  );
}

// "Defaults": used in every new quote. USD only for now.
export function DefaultsForm({
  action,
  values,
}: {
  action: Action;
  values: { markupType: string; markupValue: string; showCancellation: boolean };
}) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(action, null);
  const typed = state?.status === "error" && state.values ? state.values : null;
  const shown = typed ? { markupType: typed.markupType ?? "", markupValue: typed.markupValue ?? "", showCancellation: typed.showCancellation === "on" } : values;
  return (
    <form key={JSON.stringify(shown)} action={formAction} className="flex flex-col gap-4" noValidate>
      <Message state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className={label}>
          Currency
          <p className="rounded-[10px] border border-line bg-[#f7f5f0] px-3 py-2.5 text-sm font-normal text-ink">USD</p>
          <span className={hint}>USD only for now.</span>
        </div>
        <label className={label}>
          Default markup
          <select name="markupType" defaultValue={shown.markupType} className={input}>
            <option value="PERCENT">Percentage (%)</option>
            <option value="FIXED">Fixed per room (USD)</option>
          </select>
        </label>
        <label className={label}>
          Markup value
          <input name="markupValue" inputMode="decimal" maxLength={12} defaultValue={shown.markupValue} className={input} />
          <span className={hint}>Sets the selling price in new quotes. You can edit it on each quote.</span>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="showCancellation" defaultChecked={shown.showCancellation} className="mt-0.5 h-4 w-4 accent-brand" />
        <span>
          <strong className="block">Show cancellation terms in quotes</strong>
          <span className={hint}>Default for new quotes. You can change it on each quote.</span>
        </span>
      </label>
      <button type="submit" disabled={pending} className={`${btnPrimary} self-start`}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

// "Change password": emails a link to the agent's own login email.
export function ChangePasswordForm({ action }: { action: () => Promise<SettingsFormState> }) {
  const [state, formAction, pending] = useActionState<SettingsFormState>(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Message state={state} />
      <button type="submit" disabled={pending} className={`${btnSecondary} self-start`}>
        {pending ? "Sending…" : "Change password"}
      </button>
    </form>
  );
}
