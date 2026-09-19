import type { Category } from '@/shared/categories';

/**
 * Built-in merchant rules: the second step of categorisation, after the
 * issuer's own merchant-category column and before the LLM.
 *
 * Order matters — the first match wins — so put the specific before the general.
 * These are matched against the upper-cased description and merchant together.
 */
export interface MerchantRule {
  pattern: RegExp;
  category: Category;
}

export const MERCHANT_RULES: readonly MerchantRule[] = [
  // Fees, interest and charges.
  { pattern: /\b(?:GST|IGST|CGST|SGST)\b/, category: 'Fees & interest' },
  { pattern: /\bDCC\s*MARKUP\b/, category: 'Fees & interest' },
  { pattern: /\b(?:FINANCE CHARGE|LATE PAYMENT|OVER ?LIMIT|SURCHARGE|ANNUAL FEE|JOINING FEE)\b/, category: 'Fees & interest' },

  // Money coming in.
  { pattern: /\bINTEREST\s+(?:CR|CREDIT)/, category: 'Income' },
  { pattern: /\b(?:SALARY|PAYROLL|NEFT\s*CR|DIVIDEND|REFUND|CASHBACK CREDIT)\b/, category: 'Income' },

  // Food and groceries. The grocery arms of the food-delivery apps come first:
  // "SWIGGY INSTAMART" is a grocery run, and the plain SWIGGY rule below would
  // otherwise claim it as a restaurant order.
  { pattern: /\bSWIGGY\s*INSTAMART\b/, category: 'Groceries' },
  { pattern: /\bZOMATO\s*(?:BLINKIT|HYPERPURE|MARKET)\b/, category: 'Groceries' },
  { pattern: /\b(?:SWIGGY|ZOMATO|EATCLUB|BOX8|FAASOS|DOMINOS|PIZZA HUT|MCDONALD|KFC|BURGER KING|STARBUCKS|CHAI ?POINT|THIRD WAVE|BLUE TOKAI)\b/, category: 'Food & dining' },
  { pattern: /\b(?:RESTAURANT|CAFE|HOTEL\s+\w*\s*(?:RESTAURANT|DHABA)|DHABA|BAKERY|SWEETS|TIFFIN|CANTEEN|BIRYANI|FOODS?)\b/, category: 'Food & dining' },
  { pattern: /\b(?:BLINKIT|ZEPTO|BIGBASKET|DMART|D-?MART|JIOMART|INSTAMART|GROFERS|RELIANCE FRESH|MORE SUPERMARKET|SPENCER)\b/, category: 'Groceries' },
  { pattern: /\b(?:KIRANA|GENERAL STORES?|SUPER ?MARKET|PROVISION)\b/, category: 'Groceries' },

  // Shopping.
  { pattern: /\b(?:AMAZON|FLIPKART|MYNTRA|AJIO|MEESHO|SNAPDEAL|NYKAA|TATA CLIQ|SHOPSY)\b/, category: 'Shopping' },
  { pattern: /\b(?:CLOTH|GARMENT|TEXTILE|APPAREL|FASHION|BOUTIQUE|SAREE|TAILOR)\b/, category: 'Clothing' },
  { pattern: /\b(?:CROMA|RELIANCE DIGITAL|VIJAY SALES|APPLE STORE|ONEPLUS|SAMSUNG|MI STORE|ELECTRONIC)\b/, category: 'Electronics' },
  { pattern: /\b(?:LEATHER|FOOTWEAR|BATA|METRO SHOES|SHOE)\b/, category: 'Shopping' },

  // Travel and fuel.
  { pattern: /\b(?:UBER|OLA|RAPIDO|IRCTC|INDIGO|VISTARA|AIR INDIA|SPICEJET|MAKEMYTRIP|GOIBIBO|YATRA|CLEARTRIP|REDBUS|ABHIBUS)\b/, category: 'Travel' },
  { pattern: /\b(?:PETROL|DIESEL|FUEL|HP ?(?:CL|PETROL)|BHARAT PETROLEUM|INDIAN OIL|IOCL|BPCL|HPCL|SHELL)\b/, category: 'Fuel' },
  { pattern: /\b(?:FASTAG|TOLL|PARKING)\b/, category: 'Travel' },

  // Bills, rent and utilities.
  { pattern: /\b(?:AIRTEL|JIO|VODAFONE|VI\s+RECHARGE|BSNL|ACT FIBERNET|HATHWAY|TATA PLAY|DISH TV)\b/, category: 'Bills & utilities' },
  { pattern: /\b(?:ELECTRICITY|MSEB|BESCOM|TNEB|ADANI ELECTRIC|TATA POWER|GAS|LPG|INDANE|WATER BOARD|MUNICIPAL|BBPS)\b/, category: 'Bills & utilities' },
  { pattern: /\b(?:RENT|LANDLORD|NOBROKER|HOUSING SOCIETY|MAINTENANCE CHARGE)\b/, category: 'Rent' },

  // Learning, health, entertainment, subscriptions.
  { pattern: /\b(?:UDEMY|COURSERA|UNACADEMY|BYJU|VEDANTU|SCALER|UPGRAD|GREAT LEARNING|SCHOOL|COLLEGE|UNIVERSITY|TUITION|EDUCATION)\b/, category: 'Education' },
  { pattern: /\b(?:APOLLO|PHARMEASY|1MG|NETMEDS|MEDPLUS|HOSPITAL|CLINIC|DIAGNOSTIC|PATHOLOGY|PHARMACY|MEDICAL|DENTAL)\b/, category: 'Health' },
  { pattern: /\b(?:BOOKMYSHOW|PVR|INOX|CINEPOLIS|CINEMA|MULTIPLEX)\b/, category: 'Entertainment' },
  { pattern: /\b(?:NETFLIX|SPOTIFY|PRIME VIDEO|HOTSTAR|JIOCINEMA|SONYLIV|ZEE5|YOUTUBE PREMIUM|APPLE\.COM\/BILL|ICLOUD|GOOGLE ONE|GOOGLE PLAY|PLAYSTORE|APP STORE|OPENAI|CHATGPT|ANTHROPIC|CLAUDE\.AI|GITHUB|NOTION|FIGMA|ADOBE|MICROSOFT|CANVA)\b/, category: 'Digital & subscriptions' },

  // Investing is its own thing. It was folded into transfers on the grounds
  // that the money is moved rather than spent — true, but it makes a month
  // where you invested look identical to one where you shuffled cash between
  // your own accounts, which is the opposite of useful.
  //
  // Above the transfer rules on purpose: a broker's UPI row often carries a
  // transfer word too, and "bought shares" is the more specific fact.
  { pattern: /\b(?:ZERODHA|GROWW|UPSTOX|ANGEL ?ONE|STABLE BROKING|BROKING|SECURITIES|DEMAT|MUTUAL ?FUND|SMALLCASE|KUVERA|INDMONEY|PAYTM MONEY|COIN ?DCX|WAZIRX|VAULTED|SIP)\b/, category: 'Investments' },
  { pattern: /\b(?:NPS|PPF|ELSS|SOVEREIGN GOLD|RECURRING DEPOSIT|FIXED DEPOSIT)\b/, category: 'Investments' },

  // Transfers and ATM.
  { pattern: /\b(?:ATM|CASH WITHDRAWAL|CASH ADVANCE)\b/, category: 'Cash & transfers' },
  { pattern: /\b(?:SELF|OWN ACCOUNT|IMPS|NEFT|RTGS|FUND TRANSFER)\b/, category: 'Cash & transfers' },

];

/**
 * The issuer's own merchant category column, mapped onto our taxonomy. The Axis
 * statement prints these; other issuers print their own, added here as they
 * turn up.
 */
export const ISSUER_CATEGORY_MAP: Readonly<Record<string, Category>> = {
  'CLOTH STORES': 'Clothing',
  RESTAURANTS: 'Food & dining',
  'FAST FOOD': 'Food & dining',
  ELECTRONICS: 'Electronics',
  EDUCATION: 'Education',
  'LEATHER GOODS': 'Shopping',
  'MISC STORE': 'Shopping',
  'MISCELLANEOUS STORES': 'Shopping',
  'RETAIL STORES': 'Shopping',
  'DEPARTMENT STORES': 'Shopping',
  'GROCERY STORES': 'Groceries',
  SUPERMARKETS: 'Groceries',
  'SERVICE STATIONS': 'Fuel',
  'FUEL DEALERS': 'Fuel',
  AIRLINES: 'Travel',
  'TRAVEL AGENCIES': 'Travel',
  'HOTELS AND MOTELS': 'Travel',
  'DRUG STORES': 'Health',
  PHARMACIES: 'Health',
  'MEDICAL SERVICES': 'Health',
  'UTILITIES': 'Bills & utilities',
  'TELECOM SERVICES': 'Bills & utilities',
  'COMPUTER SERVICES': 'Digital & subscriptions',
  'DIGITAL GOODS': 'Digital & subscriptions',
  'BOOK STORES': 'Shopping',
  'JEWELRY STORES': 'Shopping',
  'SPORTING GOODS': 'Shopping',
  'ENTERTAINMENT': 'Entertainment',
  'MONEY TRANSFER': 'Cash & transfers',
  CHARGE: 'Fees & interest',
  PAYMENT: 'Cash & transfers',
};

export function categoryForIssuerCategory(issuerCategory: string | null): Category | null {
  if (!issuerCategory) return null;
  return ISSUER_CATEGORY_MAP[issuerCategory.trim().toUpperCase()] ?? null;
}

export function categoryForMerchantRule(haystack: string): Category | null {
  const upper = haystack.toUpperCase();
  for (const rule of MERCHANT_RULES) {
    if (rule.pattern.test(upper)) return rule.category;
  }
  return null;
}
