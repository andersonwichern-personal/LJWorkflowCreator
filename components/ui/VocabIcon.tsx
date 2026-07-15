import {
  Banknote,
  Bot,
  Circle,
  CircleCheck,
  ClipboardList,
  CreditCard,
  Landmark,
  type LucideIcon,
  Mail,
  Scale,
  Siren,
  Store,
  Tag,
  User,
  Wheat,
} from "lucide-react";
import type { CSSProperties } from "react";

/**
 * Resolves a Lucide icon by name for the token vocabulary (field groups,
 * starter templates). The vocabulary stores icon *names* rather than emoji so
 * the whole console renders one consistent thin-stroke icon set; unknown names
 * fall back to a neutral dot.
 */
const VOCAB_ICONS: Record<string, LucideIcon> = {
  ClipboardList,
  User,
  Wheat,
  Scale,
  Mail,
  Landmark,
  CreditCard,
  Store,
  Tag,
  Bot,
  Siren,
  CircleCheck,
  Banknote,
};

export default function VocabIcon({
  name,
  size = 14,
  className,
  style,
}: {
  name?: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = (name && VOCAB_ICONS[name]) || Circle;
  return <Icon size={size} strokeWidth={2} className={className} style={style} aria-hidden />;
}
