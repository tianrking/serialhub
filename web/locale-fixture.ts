// Existing protocol and safety regressions retain their original fixture language.
// New i18n tests explicitly reset to the product default and cover each locale.
import { setLocale } from "./src/i18n/index.ts";
setLocale("zh-Hans", false);
