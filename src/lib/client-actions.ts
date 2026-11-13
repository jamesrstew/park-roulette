/**
 * Server actions, wrapped for calling from the browser.
 *
 * A server action can throw on the client for reasons that have nothing to do
 * with the server code: no signal at the park, or an open tab calling an
 * action ID from before the last deploy. Unwrapped, that error escapes the
 * transition and takes down the whole page. These wrappers turn it into a
 * normal { ok: false } result the UI already knows how to show.
 *
 * Client components import actions from here, not from "./actions".
 */
import { isRedirectError } from "next/dist/client/components/redirect-error";
import * as A from "./actions";
import * as C from "./community-actions";
import * as P from "./phone-actions";
import type { ActionResult } from "./actions";

export type { ActionResult };

export function friendlyError(e: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return "No signal right now. Try again when you have bars!";
  const msg = e instanceof Error ? e.message : String(e);
  if (/server action/i.test(msg))
    return "The app just got an update! Refresh the page to keep going.";
  return "Couldn't reach Park Roulette. Try again?";
}

function wrap<Args extends unknown[], R extends ActionResult>(
  fn: (...args: Args) => Promise<R>,
) {
  return async (...args: Args): Promise<R | { ok: false; error: string }> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (isRedirectError(e)) throw e; // let Next navigate
      console.error(e);
      return { ok: false, error: friendlyError(e) };
    }
  };
}

export const joinWithCode = wrap(A.joinWithCode);
export const startFamily = wrap(A.startFamily);
export const updateProfile = wrap(A.updateProfile);
export const addKid = wrap(A.addKid);
export const logVisit = wrap(A.logVisit);
export const removeVisit = wrap(A.removeVisit);
export const saveReview = wrap(A.saveReview);
export const deleteReview = wrap(A.deleteReview);
export const addPark = wrap(A.addPark);
export const setParkStatus = wrap(A.setParkStatus);
export const setParkPlay = wrap(A.setParkPlay);
export const updateFeatures = wrap(A.updateFeatures);
export const voteOnFix = wrap(A.voteOnFix);
export const confirmPark = wrap(A.confirmPark);
export const reportReview = wrap(C.reportReview);
export const restoreReview = wrap(C.restoreReview);
export const removeReview = wrap(C.removeReview);
export const applyFix = wrap(C.applyFix);
export const dropFix = wrap(C.dropFix);
export const rejectPark = wrap(C.rejectPark);
export const acceptTerms = wrap(C.acceptTerms);
export const deleteMe = wrap(C.deleteMe);
export const deleteFamily = wrap(C.deleteFamily);
export const removeKid = wrap(C.removeKid);
export const sendSignInCode = wrap(P.sendSignInCode);
export const checkSignInCode = wrap(P.checkSignInCode);
export const sendAddPhoneCode = wrap(P.sendAddPhoneCode);
export const checkAddPhoneCode = wrap(P.checkAddPhoneCode);
export const movePhoneHere = wrap(P.movePhoneHere);
export const removePhone = wrap(P.removePhone);
export const startClaim = wrap(P.startClaim);
export const finishClaim = wrap(P.finishClaim);
export type { PhoneResult } from "./phone-actions";
/** Used as a <form action>, which Next handles itself. */
export const signOut = A.signOut;
