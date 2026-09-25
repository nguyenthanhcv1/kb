import globals from "globals";

import base from "./base.js";

/** Flat config for Node services (apps/collab, scripts). */
export default [
  ...base,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
];
