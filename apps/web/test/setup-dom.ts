import { configure } from "@testing-library/dom";

// Component tests run in parallel workers on small CI runners: a Radix dialog plus a server-action
// round trip can take longer than Testing Library's 1 s default for `findBy*` / `waitFor`.
configure({ asyncUtilTimeout: 5000 });
