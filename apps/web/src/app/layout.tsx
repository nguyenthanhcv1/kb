import type { ReactNode } from "react";

// Minimal root layout. App shell, theme and i18n are added in T0.1b / T0.3b (claude-1).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
