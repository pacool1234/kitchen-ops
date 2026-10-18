import { Locale, type BaseUnit } from "@kitchen-ops/shared";
import { useI18n } from "vue-i18n";
import { formatDecimalInput } from "../components/ui/number";
import { useT } from "../i18n";
import { formatQuantity } from "../i18n/format";

// A pack as people read it (#89): "1 caja = 6 kg", "2,5 docena = 30 uds.".

/** Writes a pack, with its base units if they're known. Call it in `setup`. */
export function usePackText() {
  const t = useT();
  const { locale } = useI18n();
  return (
    pack: { quantity: string; unit: string },
    baseUnit: BaseUnit,
    baseUnits: number | null,
  ): string => {
    const lang = Locale.parse(locale.value);
    const unit =
      pack.unit === baseUnit ? t(`unitsShort.${baseUnit}`) : pack.unit;
    const amount = `${formatDecimalInput(pack.quantity, lang)} ${unit}`;
    return baseUnits === null
      ? amount
      : t("supplierProducts.packText", {
          amount,
          quantity: formatQuantity(baseUnits, baseUnit, lang),
        });
  };
}
