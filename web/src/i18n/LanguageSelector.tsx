import DisplaySettings from "../DisplaySettings";
import { getLocalePolicy, LOCALES, setLocale, t } from "./index";
import { useLocale } from "./useLocale";

export function LanguageSelector() {
  const locale = useLocale();
  return <div className="interface-preferences"><DisplaySettings /><label className="language-selector"><span aria-hidden="true">◎</span><select aria-label={t("Interface language")} value={locale}
    onChange={event => setLocale(event.target.value)} dir="ltr">
    {LOCALES.filter(item => getLocalePolicy().enabledLocales.includes(item.id)).map(item => <option key={item.id} value={item.id} lang={item.id}>{item.name}</option>)}
  </select></label></div>;
}
