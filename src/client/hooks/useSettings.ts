import { useState } from "react";

const EPHEMERAL_KEY = "grove_tax_ephemeral";

export function useSettings() {
  const [ephemeral, setEphemeralState] = useState(() => localStorage.getItem(EPHEMERAL_KEY) === "true");

  const setEphemeral = (value: boolean) => {
    setEphemeralState(value);
    if (value) localStorage.setItem(EPHEMERAL_KEY, "true");
    else localStorage.removeItem(EPHEMERAL_KEY);
  };

  return { ephemeral, setEphemeral };
}
