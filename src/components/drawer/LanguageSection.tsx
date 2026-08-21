import { Languages } from "lucide-react";
import type { Locale } from "../../domain/chat";
import type { UiCopy } from "../../i18n/messages";

export interface LanguageSectionProps {
  copy: UiCopy;
  locale: Locale;
  onLocale: (locale: Locale) => Promise<void>;
}

export function LanguageSection({ copy, locale, onLocale }: LanguageSectionProps) {
  return (
    <section className="drawer__language" aria-labelledby="language-title">
      <h2 id="language-title">
        <Languages aria-hidden="true" size={19} />
        {copy.localeLabel}
      </h2>
      <div>
        <button
          aria-pressed={locale === "zh-CN"}
          onClick={() => void onLocale("zh-CN")}
          type="button"
        >
          {copy.chinese}
        </button>
        <button
          aria-pressed={locale === "ja-JP"}
          onClick={() => void onLocale("ja-JP")}
          type="button"
        >
          {copy.japanese}
        </button>
      </div>
    </section>
  );
}
