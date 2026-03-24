"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="ai-workflow-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

