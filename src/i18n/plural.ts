type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/**
 * Picks the plural form for `count` according to the locale's CLDR rules
 * (e.g. English has one/other, Ukrainian has one/few/many/other).
 */
export const plural = (locale: string, count: number, forms: PluralForms): string =>
  forms[new Intl.PluralRules(locale).select(count)] ?? forms.other;
