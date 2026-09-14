import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useAuthActions,
} from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import { AuthScreen } from "./components/AuthScreen";
import { Trial } from "./components/Trial";
import { Board } from "./components/Board";
import { Icon } from "./components/Icon";
import { Onboarding } from "./components/Onboarding";

/**
 * Three states, in order of how little the app knows: still checking, signed
 * out, signed in. Once signed in there is one more gate — a household — and
 * then the board, which is the whole product.
 */
export function App() {
  // `/demo` is not a separate, lesser app. It signs the visitor in
  // anonymously, gives them a real household, and then falls through to the
  // same board a signed-up family sees — so there is only ever one product to
  // keep working.
  const [trialDone, setTrialDone] = useState(false);
  const wantsTrial =
    window.location.pathname.replace(/\/+$/, "") === "/demo";

  if (wantsTrial && !trialDone) {
    return <Trial onReady={() => setTrialDone(true)} />;
  }

  return (
    <>
      <AuthLoading>
        <Splash />
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen />
      </Unauthenticated>
      <Authenticated>
        <SignedIn />
      </Authenticated>
    </>
  );
}

function SignedIn() {
  const { signOut } = useAuthActions();
  const me = useQuery(api.users.me);
  const households = useQuery(api.households.mine);

  if (me === undefined || households === undefined) return <Splash />;
  if (me === null) return <Splash />;

  // One household per account for now. A second would need a switcher in the
  // header, and no family has asked for one before they have their first.
  const household = households[0];
  if (household === undefined) return <Onboarding />;

  return (
    <Board
      householdId={household._id}
      userId={me._id}
      onSignOut={() => {
        void signOut();
      }}
    />
  );
}

/**
 * Shown for the fraction of a second before the session resolves. Quiet on
 * purpose: a spinner here would flash on every load of a signed-in board.
 */
function Splash() {
  return (
    <div className="grid min-h-full place-items-center">
      <div className="flex items-center gap-2 text-ink-faint">
        <Icon name="backpack" size={20} strokeWidth={1.4} />
        <span className="display text-[16px]">Backpack</span>
      </div>
    </div>
  );
}
