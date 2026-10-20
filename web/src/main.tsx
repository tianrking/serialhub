import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Desktop from "./Desktop.tsx";
import { initializeI18n, syncLocaleStorage } from "./i18n/index.ts";
import "./index.css";
import "./i18n/i18n.css";
import "./workbenchTheme.css";

initializeI18n({ defaultLocale: import.meta.env.VITE_I18N_DEFAULT_LOCALE, enabledLocales: import.meta.env.VITE_I18N_ENABLED_LOCALES });
window.addEventListener("storage", syncLocaleStorage);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>,
);
