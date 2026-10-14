"use client";

import { useActionState } from "react";

import { saveShopAddress, type ShopFormState } from "./actions";

export function ShopForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState<ShopFormState, FormData>(saveShopAddress, { values: { address: current } });

  return (
    // Remount after each submit so the field shows what was submitted (see CustomerForm).
    <form key={JSON.stringify(state)} action={formAction} noValidate className="shop-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="shop-address">Shop address</label>
        <input
          id="shop-address"
          name="address"
          defaultValue={state.values.address}
          maxLength={300}
          autoComplete="street-address"
          placeholder="61 Clarendon Rd, Lake Ronkonkoma, NY"
          autoFocus={Boolean(state.fieldError)}
          aria-invalid={state.fieldError ? true : undefined}
          aria-describedby={state.fieldError ? "shop-address-error" : "shop-address-hint"}
        />
        {state.fieldError ? (
          <div id="shop-address-error" className="field-error">
            {state.fieldError}
          </div>
        ) : (
          <div id="shop-address-hint" className="hint">
            Where your crews start each day. Include the town and state. Customer addresses without a town are looked up in
            your shop&apos;s town.
          </div>
        )}
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Finding it…" : "Save shop address"}
        </button>
      </div>
    </form>
  );
}
